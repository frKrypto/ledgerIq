import { useEffect } from 'react';
import { useApp } from '../lib/store.jsx';

/**
 * Milestone + badge celebration. Deliberately a single dismissible card rather
 * than confetti everywhere — this is a career tool first, gamified second.
 */
export function Celebration() {
  const { celebration, dismissCelebration } = useApp();

  useEffect(() => {
    if (!celebration) return undefined;
    const onKey = (e) => e.key === 'Escape' && dismissCelebration();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [celebration, dismissCelebration]);

  if (!celebration) return null;
  const { badges = [], milestones = [] } = celebration;
  if (!badges.length && !milestones.length) return null;

  const headlineMilestone = milestones.sort((a, b) => b.percent - a.percent)[0];

  return (
    <div className="celebration" role="dialog" aria-modal="true" aria-label="Milestone reached" onClick={dismissCelebration}>
      <div className="celebration-card" onClick={(e) => e.stopPropagation()}>
        <div className="celebration-icon" aria-hidden="true">
          {headlineMilestone?.percent === 100 ? '🏁' : badges[0]?.icon || '🎉'}
        </div>

        {headlineMilestone && (
          <>
            <h2>
              {headlineMilestone.percent === 100
                ? `${headlineMilestone.pathName} — finished`
                : `${headlineMilestone.percent}% through ${headlineMilestone.pathName}`}
            </h2>
            <p className="muted small">
              {headlineMilestone.percent === 100
                ? 'Every required step done. Time to be applying, if you are not already.'
                : 'Keep the streak going — the middle is the part most people quit in.'}
            </p>
          </>
        )}

        {badges.length > 0 && (
          <div className="stack-sm" style={{ marginTop: headlineMilestone ? '1rem' : 0 }}>
            {!headlineMilestone && <h2>Badge earned</h2>}
            {badges.map((badge) => (
              <div key={badge.id} className="row" style={{ justifyContent: 'center' }}>
                <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>{badge.icon}</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 620 }}>{badge.name}</div>
                  <div className="faint">{badge.description}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <button type="button" className="btn btn-primary" style={{ marginTop: '1.25rem', width: '100%' }} onClick={dismissCelebration}>
          Back to it
        </button>
      </div>
    </div>
  );
}
