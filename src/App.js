import React, { useState, useEffect } from 'react';
import ScheduleGrid from './ScheduleGridView';
import { PRESSES, DAYS, SHIFTS } from './Constants';

// Hash routing so a specific slot is bookmarkable/linkable, e.g.
// #/PRESS%201/Wednesday/1st - same reasoning as picos's App.js: this
// deploys to GitHub Pages (static hosting, no server-side rewrite), and a
// hash never leaves the client so it works with zero extra hosting config.
function parseHash() {
  const parts = decodeURIComponent(window.location.hash.replace(/^#\/?/, '')).split('/');
  if (parts.length === 3 && parts.every(Boolean)) {
    return { press: parts[0], day: parts[1], shift: parts[2] };
  }
  return null;
}

function IndexView({ onOpen }) {
  const [press, setPress] = useState(PRESSES[0]);
  const [day, setDay] = useState(DAYS[0]);
  const [shift, setShift] = useState(SHIFTS[0]);

  return (
    <div style={{ padding: '1.5rem', maxWidth: 480, margin: '0 auto',
                  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' }}>
      <h1 style={{ fontSize: '1.4rem' }}>Press Schedule</h1>
      <p style={{ color: '#6b7a8c', fontSize: '.9rem' }}>
        Pick a press, day, and shift to open its schedule.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', marginTop: '1rem' }}>
        <label>Press
          <select value={press} onChange={(e) => setPress(e.target.value)} style={{ width: '100%', marginTop: '.2rem' }}>
            {PRESSES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label>Day
          <select value={day} onChange={(e) => setDay(e.target.value)} style={{ width: '100%', marginTop: '.2rem' }}>
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label>Shift
          <select value={shift} onChange={(e) => setShift(e.target.value)} style={{ width: '100%', marginTop: '.2rem' }}>
            {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button
          type="button"
          style={{ marginTop: '.5rem', padding: '.6rem', background: '#2e6ba8', color: '#fff',
                   border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '.95rem' }}
          onClick={() => onOpen(press, day, shift)}
        >
          Open schedule
        </button>
      </div>
    </div>
  );
}

function App() {
  const [route, setRoute] = useState(() => parseHash());

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const open = (press, day, shift) => {
    window.location.hash = `/${encodeURIComponent(press)}/${encodeURIComponent(day)}/${encodeURIComponent(shift)}`;
    setRoute({ press, day, shift });
  };

  const back = () => {
    window.location.hash = '';
    setRoute(null);
  };

  if (route) {
    return <ScheduleGrid press={route.press} dayOfWeek={route.day} shift={route.shift} onBack={back} />;
  }
  return <IndexView onOpen={open} />;
}

export default App;
