import { money, STEP_TYPE_LABEL } from '../lib/format.js';

export function ProgressRing({ percent, size = 56, label }) {
  const radius = (size - 7) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, percent) / 100) * circumference;
  const complete = percent >= 100;

  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label || `${percent}% complete`}>
      <circle className="ring-track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth="6" />
      <circle
        className={`ring-value${complete ? ' complete' : ''}`}
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text className="ring-label" x="50%" y="50%" dominantBaseline="central" textAnchor="middle">
        {percent}%
      </text>
    </svg>
  );
}

export function Bar({ percent }) {
  return (
    <div className="bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className={`bar-fill${percent >= 100 ? ' complete' : ''}`} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

export function Stat({ value, label }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function StepTags({ step, showType = true }) {
  return (
    <div className="step-tags">
      {showType && <span className={`tag type-${step.type}`}>{STEP_TYPE_LABEL[step.type]}</span>}
      <span className="tag">{step.estimatedTime}</span>
      <span className={`tag ${step.costEstimate > 0 ? 'tag-paid' : 'tag-free'}`}>
        {step.costEstimate > 0 ? money(step.costEstimate) : 'Free'}
      </span>
      {step.noPcRequired && <span className="tag tag-nopc">📱 No PC needed</span>}
      {step.optional && <span className="tag">Optional</span>}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function DifficultyTag({ level }) {
  const label = { gentle: 'Gentle start', moderate: 'Moderate', hard: 'Demanding' }[level] || level;
  return <span className={`tag difficulty-${level}`}>{label}</span>;
}
