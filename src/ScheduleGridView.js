import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useDrag, useDrop, DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { API_BASE, REQUEST_TIMEOUT } from './Constants';

// Renders one (day_of_week, shift) Press 2 schedule as an editable grid
// shaped like the real sheet it replaces (see CLAUDE.md for the source
// inspection this is built from, and its "The Press Reports folder"
// section specifically - Press 2 is the only press this needs to cover,
// confirmed with the user 2026-09-24) - NOT a generic spreadsheet:
//
//   - a title/date header
//   - a roster side-panel (Press Op, Saw Op #1/#2, Oven Probes, Supervisor)
//   - an ORDERED list of rows, each either a job (one cell per column) or a
//     free-text note - row position is the run sequence, not sortable data
//
// Every field is a plain text input BY DEFAULT, not a typed number input -
// real production entries include "BAL." and "trial-274" in columns that
// look numeric, inherited from the legacy sheet. Rejecting those would be a
// regression against the sheet this replaces, not an improvement.
//
// column_types is the opt-in exception, not a blanket switch: a column with
// no entry stays exactly as loose as before. So far it only marks columns
// that DON'T exist in the real legacy sheet at all - Oven Cavity and Time
// Down (Minutes) are new fields being introduced for this app, confirmed
// with the user 2026-09-24, not something inherited with messy real-world
// history to accommodate - so there's no reason to leave them untyped.
// api/app.py enforces the same list server-side; see its _validate_schedule_body.
//
// DEFAULT_COLUMNS started as Press 2's real, confirmed column set (a wide
// scan of D-3 Press Report - Thursday 2nd Shift.xls, not guessed), then
// three new ones were added for this app specifically (not in the source
// file - Oven Cavity, Downtime Code, Time Down). Deliberately excludes the
// formula-driven efficiency block (Minutes Per Die, Gross Pounds/Hour,
// etc.) - decided out of scope, see README.

const DEFAULT_COLUMNS = [
  'die_no', 'suffix', 'job_no', 'part_no', 'alloy_temper', 'blts',
  'cut_length', 'est_wt_ft', 'cast_no', 'blt_length', 'blts_ran',
  'die_temp', 'oven_cavity', 'start_time', 'stop_time', 'die_failure',
  'die_pull', 'downtime_code', 'time_down', 'comments',
];

const DEFAULT_COLUMN_TYPES = { oven_cavity: 'number', time_down: 'number' };

const COLUMN_LABELS = {
  die_no: 'Die #', suffix: 'Suffix', job_no: 'Job #', part_no: 'Part #',
  alloy_temper: 'Alloy/temper', blts: '# blts', cut_length: 'Cut length',
  est_wt_ft: 'Est wt/ft', cast_no: 'Cast #', blt_length: 'blt length',
  blts_ran: 'blts ran', die_temp: 'Die Temp', oven_cavity: 'Oven Cavity',
  start_time: 'Start time', stop_time: 'Stop time', die_failure: 'Die Failure',
  die_pull: 'Die Pull', downtime_code: 'Downtime Code',
  time_down: 'Time Down (min)', comments: 'Comments',
  str_blt_length: 'Str blt length',
};

function columnLabel(key) {
  return COLUMN_LABELS[key] || key;
}

function emptyJobRow(columns) {
  const row = { kind: 'job' };
  columns.forEach((c) => { row[c] = ''; });
  return row;
}

function blankDoc() {
  return {
    date: '',
    // Press 2's real labels (rows 61-65 of the real file): PRESS OP:,
    // SAW OP #1:, SAW OP #2:, OVEN PROBES:, SUPERVISOR: - not the other
    // (out-of-scope) file's "REVIEWED BY:". The API/grid don't actually
    // require these exact keys - see README's "roster keys are not fixed"
    // - this is just the sensible starting point for a brand-new slot.
    roster: { press_op: '', saw_op_1: '', saw_op_2: '', oven_probes: '', supervisor: '' },
    columns: DEFAULT_COLUMNS,
    column_types: DEFAULT_COLUMN_TYPES,
    rows: [],
  };
}

const ROW_DRAG_TYPE = 'schedule-row';

function RowControls({ index, onInsertJob, onInsertNote, onDelete, onMove, count }) {
  return (
    <div className="ps-row-controls">
      <button type="button" title="Insert job row below" onClick={() => onInsertJob(index)}>+job</button>
      <button type="button" title="Insert note row below" onClick={() => onInsertNote(index)}>+note</button>
      <button type="button" title="Move up" disabled={index === 0} onClick={() => onMove(index, index - 1)}>&uarr;</button>
      <button type="button" title="Move down" disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>&darr;</button>
      <button type="button" title="Delete this row" className="ps-danger" onClick={() => onDelete(index)}>&times;</button>
    </div>
  );
}

function GridRow({ row, index, columns, columnTypes, onChange, onMove, ...controls }) {
  const ref = useRef(null);

  const [, drop] = useDrop({
    accept: ROW_DRAG_TYPE,
    hover(item) {
      if (item.index === index) return;
      onMove(item.index, index);
      item.index = index;
    },
  });
  const [{ isDragging }, drag] = useDrag({
    type: ROW_DRAG_TYPE,
    item: { index },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });
  drag(drop(ref));

  const isNote = row.kind === 'note';

  return (
    <tr ref={ref} className={`ps-row${isNote ? ' ps-note-row' : ''}${isDragging ? ' ps-dragging' : ''}`}>
      <td className="ps-drag-handle" title="Drag to reorder">&#8942;&#8942;</td>
      {isNote ? (
        <td className="ps-note-cell" colSpan={columns.length}>
          <input
            type="text"
            value={row.text || ''}
            placeholder="Note / instruction for this point in the run"
            onChange={(e) => onChange(index, 'text', e.target.value)}
          />
        </td>
      ) : (
        columns.map((c) => {
          const isNumber = (columnTypes || {})[c] === 'number';
          return (
            <td key={c}>
              <input
                type={isNumber ? 'number' : 'text'}
                step={isNumber ? 'any' : undefined}
                inputMode={isNumber ? 'decimal' : undefined}
                value={row[c] || ''}
                onChange={(e) => onChange(index, c, e.target.value)}
              />
            </td>
          );
        })
      )}
      <td className="ps-row-controls-cell">
        <RowControls index={index} onMove={onMove} {...controls} />
      </td>
    </tr>
  );
}

function ScheduleGrid({ press, dayOfWeek, shift, onBack }) {
  const [doc, setDoc] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | saving | saved | error | not_found
  const [error, setError] = useState(null);
  const [editor, setEditor] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState(null);

  const url = `${API_BASE}/api/schedule/${encodeURIComponent(press)}/${encodeURIComponent(dayOfWeek)}/${encodeURIComponent(shift)}`;

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await axios.get(url, { timeout: REQUEST_TIMEOUT });
      setDoc(res.data);
      setStatus('ready');
    } catch (err) {
      if (err.response && err.response.status === 404) {
        setDoc(blankDoc());
        setStatus('not_found');
      } else {
        setError(err);
        setStatus('error');
      }
    }
  }, [url]);

  useEffect(() => { load(); }, [load]);

  const columns = (doc && doc.columns) || DEFAULT_COLUMNS;
  const columnTypes = (doc && doc.column_types) || {};

  const setField = (path, value) => {
    setDoc((prev) => {
      const next = { ...prev };
      if (path[0] === 'date') next.date = value;
      if (path[0] === 'roster') next.roster = { ...prev.roster, [path[1]]: value };
      return next;
    });
  };

  const setRowField = (index, field, value) => {
    setDoc((prev) => {
      const rows = prev.rows.slice();
      rows[index] = { ...rows[index], [field]: value };
      return { ...prev, rows };
    });
  };

  const insertRow = (afterIndex, newRow) => {
    setDoc((prev) => {
      const rows = prev.rows.slice();
      rows.splice(afterIndex + 1, 0, newRow);
      return { ...prev, rows };
    });
  };

  const deleteRow = (index) => {
    setDoc((prev) => {
      const rows = prev.rows.slice();
      rows.splice(index, 1);
      return { ...prev, rows };
    });
  };

  const moveRow = (from, to) => {
    setDoc((prev) => {
      if (to < 0 || to >= prev.rows.length) return prev;
      const rows = prev.rows.slice();
      const [moved] = rows.splice(from, 1);
      rows.splice(to, 0, moved);
      return { ...prev, rows };
    });
  };

  const save = async () => {
    setStatus('saving');
    try {
      const body = { ...doc };
      if (editor.trim()) body.editor = editor.trim();
      const res = await axios.put(url, body, { timeout: REQUEST_TIMEOUT });
      setDoc(res.data);
      setStatus('saved');
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'ready' : s)), 2000);
    } catch (err) {
      setError(err);
      setStatus('error');
    }
  };

  const loadHistory = async () => {
    setShowHistory(true);
    try {
      const res = await axios.get(`${url}/history`, { timeout: REQUEST_TIMEOUT });
      setHistory(res.data.history);
    } catch (err) {
      setHistory([]);
    }
  };

  if (status === 'loading' || !doc) {
    return <div className="ps-view"><p>Loading…</p></div>;
  }

  return (
    <div className="ps-view">
      <style>{CSS}</style>
      <div className="ps-header-bar">
        <button className="ps-back" onClick={onBack}>&larr; Back</button>
        <h1>{press}</h1>
        <div className="ps-header-field">
          <label>Date</label>
          <input type="date" value={doc.date || ''} onChange={(e) => setField(['date'], e.target.value)} />
        </div>
        <div className="ps-header-field">
          <label>Day / Shift</label>
          <b>{dayOfWeek} &middot; {shift}</b>
        </div>
      </div>

      {status === 'not_found' && (
        <div className="ps-note-banner">This slot has never been saved - starting from a blank schedule.</div>
      )}
      {status === 'error' && (
        <div className="ps-error-banner">
          {error && error.response ? `Save failed: ${error.response.data && error.response.data.error}` : 'Could not reach the API.'}
        </div>
      )}

      <div className="ps-roster">
        {Object.keys(doc.roster || {}).map((key) => (
          <div key={key} className="ps-roster-field">
            <label>{columnLabel(key) === key ? key.replace(/_/g, ' ') : columnLabel(key)}</label>
            <input
              type="text"
              value={doc.roster[key] || ''}
              onChange={(e) => setField(['roster', key], e.target.value)}
            />
          </div>
        ))}
      </div>

      <DndProvider backend={HTML5Backend}>
        <table className="ps-grid">
          <thead>
            <tr>
              <th></th>
              {columns.map((c) => (
                <th key={c} title={columnTypes[c] === 'number' ? 'Numbers only' : undefined}>
                  {columnLabel(c)}
                  {columnTypes[c] === 'number' && <span className="ps-numeric-badge">#</span>}
                </th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {doc.rows.map((row, i) => (
              <GridRow
                key={i}
                row={row}
                index={i}
                columns={columns}
                columnTypes={columnTypes}
                onChange={setRowField}
                onMove={moveRow}
                onInsertJob={(idx) => insertRow(idx, emptyJobRow(columns))}
                onInsertNote={(idx) => insertRow(idx, { kind: 'note', text: '' })}
                onDelete={deleteRow}
                count={doc.rows.length}
              />
            ))}
          </tbody>
        </table>
      </DndProvider>

      <div className="ps-add-row-bar">
        <button type="button" onClick={() => insertRow(doc.rows.length - 1, emptyJobRow(columns))}>+ Job row</button>
        <button type="button" onClick={() => insertRow(doc.rows.length - 1, { kind: 'note', text: '' })}>+ Note row</button>
      </div>

      <div className="ps-save-bar">
        <input
          type="text"
          className="ps-editor-name"
          placeholder="Your name (optional)"
          value={editor}
          onChange={(e) => setEditor(e.target.value)}
        />
        <button type="button" className="ps-save" disabled={status === 'saving'} onClick={save}>
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {status === 'saved' && <span className="ps-saved-tick">Saved</span>}
        <button type="button" className="ps-history-toggle" onClick={loadHistory}>History</button>
      </div>

      {showHistory && (
        <div className="ps-history">
          <h2>History <button type="button" onClick={() => setShowHistory(false)}>close</button></h2>
          {history === null ? <p>Loading…</p> : history.length === 0 ? <p>No saved history yet.</p> : (
            <ul>
              {history.map((h, i) => (
                <li key={i}>{h.saved_at} {h.updated_by ? `— ${h.updated_by}` : ''} — {h.rows ? h.rows.length : 0} rows</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const CSS = `
.ps-view { padding: 1.25rem 1.5rem 3rem; max-width: 1200px; margin: 0 auto;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #17202b; }
.ps-header-bar { display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
.ps-header-bar h1 { font-size: 1.4rem; margin: 0; }
.ps-back { background: #eef2f7; border: 1px solid #d3dce6; border-radius: 6px; padding: .35rem .7rem; cursor: pointer; }
.ps-header-field { display: flex; flex-direction: column; gap: .15rem; font-size: .78rem; color: #6b7a8c; }
.ps-header-field input { font-size: .95rem; padding: .25rem .4rem; }

.ps-roster { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem;
  background: #f6f8fa; border: 1px solid #dde4ec; border-radius: 8px; padding: .75rem 1rem; }
.ps-roster-field { display: flex; flex-direction: column; gap: .15rem; font-size: .72rem;
  text-transform: uppercase; letter-spacing: .04em; color: #8b98a6; }
.ps-roster-field input { font-size: .85rem; padding: .2rem .35rem; min-width: 130px; text-transform: none; }

.ps-grid { border-collapse: collapse; width: 100%; font-size: .82rem; margin-bottom: .75rem; }
.ps-grid th { background: #f0f3f7; text-align: left; padding: .35rem .4rem; border: 1px solid #dde4ec;
  font-size: .72rem; text-transform: uppercase; letter-spacing: .03em; color: #5a6b7d; }
.ps-grid td { border: 1px solid #eef1f5; padding: 0; }
.ps-grid input { width: 100%; box-sizing: border-box; border: none; padding: .3rem .35rem; font-size: .82rem;
  font-family: inherit; background: transparent; }
.ps-grid input:focus { outline: 2px solid #3d82c4; outline-offset: -2px; background: #fff; }
.ps-grid input[type="number"] { font-variant-numeric: tabular-nums; }
.ps-numeric-badge { display: inline-block; margin-left: .3rem; font-size: .62rem;
  color: #3d82c4; background: #e8f0fa; border-radius: 3px; padding: 0 .3rem;
  vertical-align: middle; letter-spacing: 0; text-transform: none; }
.ps-row.ps-dragging { opacity: .4; }
.ps-note-row { background: #fdf6e3; }
.ps-note-cell input { font-style: italic; font-weight: 600; }
.ps-drag-handle { cursor: grab; text-align: center; color: #b3bfca; width: 1.4rem; user-select: none; }
.ps-row-controls-cell { white-space: nowrap; }
.ps-row-controls { display: flex; gap: .2rem; padding: .15rem; }
.ps-row-controls button { font-size: .72rem; padding: .1rem .35rem; border: 1px solid #d3dce6;
  background: #fff; border-radius: 4px; cursor: pointer; }
.ps-row-controls button:disabled { opacity: .35; cursor: default; }
.ps-row-controls button.ps-danger { color: #b3261e; border-color: #f0c9c5; }

.ps-add-row-bar { display: flex; gap: .5rem; margin-bottom: 1.25rem; }
.ps-add-row-bar button { padding: .4rem .8rem; border: 1px solid #d3dce6; background: #f6f8fa;
  border-radius: 6px; cursor: pointer; font-size: .85rem; }

.ps-save-bar { display: flex; align-items: center; gap: .6rem; }
.ps-editor-name { padding: .4rem .6rem; border: 1px solid #d3dce6; border-radius: 6px; font-size: .85rem; }
.ps-save { padding: .45rem 1.1rem; border: none; background: #2e6ba8; color: #fff; border-radius: 6px;
  cursor: pointer; font-size: .9rem; }
.ps-save:disabled { opacity: .6; cursor: default; }
.ps-saved-tick { color: #2c6b41; font-size: .85rem; }
.ps-history-toggle { margin-left: auto; padding: .35rem .7rem; border: 1px solid #d3dce6; background: #fff;
  border-radius: 6px; cursor: pointer; font-size: .82rem; }

.ps-history { margin-top: 1.5rem; border-top: 1px solid #dde4ec; padding-top: 1rem; }
.ps-history ul { list-style: none; padding: 0; font-size: .82rem; }
.ps-history li { padding: .25rem 0; border-bottom: 1px solid #f0f3f7; }

.ps-note-banner, .ps-error-banner { padding: .55rem .8rem; border-radius: 6px; font-size: .85rem; margin-bottom: 1rem; }
.ps-note-banner { background: #eef2f7; color: #35455a; }
.ps-error-banner { background: #fdecec; color: #8c2f2f; }

@media (max-width: 700px) {
  .ps-grid { font-size: .74rem; }
}
`;

export default ScheduleGrid;
