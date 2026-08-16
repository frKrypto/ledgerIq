import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';

const WIDTH = 820;
const HEIGHT = 640;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const R = 230;

/** Wraps a path name onto at most two short lines so labels stay legible on a phone. */
function wrap(name, max = 15) {
  const words = name.replace(' / ', '/').split(' ');
  const lines = [''];
  for (const word of words) {
    const line = lines.at(-1);
    if (line && (line + ' ' + word).length > max) lines.push(word);
    else lines[lines.length - 1] = line ? `${line} ${word}` : word;
  }
  return lines.slice(0, 2);
}

export function PivotMap() {
  const { paths, summary } = useApp();
  const [focus, setFocus] = useState(null);

  const nodes = useMemo(() => {
    const count = paths.length || 1;
    return paths.map((path, index) => {
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
      return {
        path,
        x: CX + R * Math.cos(angle),
        y: CY + R * Math.sin(angle),
        cos: Math.cos(angle),
        sin: Math.sin(angle),
      };
    });
  }, [paths]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.path.id, n])), [nodes]);

  const links = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const node of nodes) {
      for (const targetId of node.path.nextPaths) {
        const target = byId.get(targetId);
        if (!target) continue;
        const key = [node.path.id, targetId].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ from: node, to: target, key });
      }
    }
    return out;
  }, [nodes, byId]);

  const focused = focus ? paths.find((p) => p.id === focus) : null;
  const touched = new Set((summary.perPath || []).filter((p) => p.touched).map((p) => p.pathId));

  const isActiveLink = (link) => focus && (link.from.path.id === focus || link.to.path.id === focus);

  return (
    <>
      <div className="page-head">
        <h1>Pivot map</h1>
        <p className="lede">
          These paths share most of their foundations. Changing your mind after six months usually costs weeks, not
          years — the lines show which switches are cheapest. Tap a path to see where it leads.
        </p>
      </div>

      <div className="card card-pad">
        <div className="pivot-scroll">
          <svg
            className="pivot-map"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label="Diagram of how career paths connect"
          >
            {links.map((link) => (
              <path
                key={link.key}
                className={`pivot-link${isActiveLink(link) ? ' active' : ''}`}
                d={`M ${link.from.x} ${link.from.y} Q ${CX} ${CY} ${link.to.x} ${link.to.y}`}
                opacity={focus && !isActiveLink(link) ? 0.15 : 0.75}
              />
            ))}

            {nodes.map((node) => {
              const active = focus === node.path.id;
              const neighbour = focused?.nextPaths.includes(node.path.id);
              const lines = wrap(node.path.name);
              const anchor = node.cos > 0.3 ? 'start' : node.cos < -0.3 ? 'end' : 'middle';
              const labelX = node.x + node.cos * 34;
              // Labels sit outside the circle. Above it, the block has to be
              // lifted by its own height so the last line clears the node.
              const labelY =
                node.sin < -0.3
                  ? node.y - 34 - 13 * (lines.length - 1)
                  : node.sin > 0.3
                    ? node.y + 46
                    : node.y + node.sin * 34 - 4;

              return (
                <g key={node.path.id} opacity={focus && !active && !neighbour ? 0.35 : 1}>
                  <circle
                    className={`pivot-node${active ? ' active' : ''}${touched.has(node.path.id) ? ' started' : ''}`}
                    cx={node.x}
                    cy={node.y}
                    r={24}
                    onClick={() => setFocus(active ? null : node.path.id)}
                    role="button"
                    tabIndex={0}
                    aria-label={node.path.name}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setFocus(active ? null : node.path.id)}
                  />
                  <text
                    className="pivot-label"
                    x={node.x}
                    y={node.y + 4}
                    textAnchor="middle"
                    style={{ fontSize: '13px' }}
                    pointerEvents="none"
                  >
                    {node.path.totals.requiredSteps}
                  </text>
                  {lines.map((line, i) => (
                    <text key={line} className="pivot-label" x={labelX} y={labelY + i * 13} textAnchor={anchor}>
                      {line}
                    </text>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
        <p className="faint center" style={{ marginTop: '0.5rem' }}>
          The number in each circle is how many required steps that path has. Circles outlined in green are ones you've
          started.
        </p>
      </div>

      {focused ? (
        <div className="card card-pad" style={{ marginTop: '1.25rem' }}>
          <div className="row-between">
            <h2 style={{ margin: 0 }}>{focused.name}</h2>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFocus(null)}>
              Clear
            </button>
          </div>
          <p className="muted small">{focused.tagline}</p>
          <h3>Pivots naturally into</h3>
          <div className="row">
            {focused.nextPaths.map((id) => {
              const target = paths.find((p) => p.id === id);
              return (
                <button key={id} type="button" className="btn btn-sm" onClick={() => setFocus(id)}>
                  {target?.name || id}
                </button>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: '1rem' }}>
            <Link className="btn btn-primary btn-sm" to={`/paths/${focused.id}`}>
              Open {focused.name}
            </Link>
          </div>
        </div>
      ) : (
        <div className="callout" style={{ marginTop: '1.25rem' }}>
          <strong>Why this matters</strong>
          The most common regret in these career changes is not picking wrong — it's freezing for months because picking
          feels permanent. It isn't. IT support converts into networking, security, or cloud; analytics converts into
          business analysis or database work; QA converts into software engineering. Start somewhere reachable.
        </div>
      )}
    </>
  );
}
