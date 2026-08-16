import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { Stat } from '../components/common.jsx';
import { dollars, money } from '../lib/format.js';

export function Budget() {
  const { paths, pathsById, user, summary, progressByStep } = useApp();
  const [pathId, setPathId] = useState(user?.primaryPath || paths[0]?.id);
  const path = pathsById.get(pathId);

  if (!path) return <div className="empty">Loading…</div>;

  const paidSteps = path.steps.filter((step) => step.costEstimate > 0);
  const spentOnPath = summary.perPath?.find((p) => p.pathId === pathId)?.costSpent || 0;
  const remainingRequired = paidSteps
    .filter((step) => !step.optional && progressByStep.get(step.id)?.status !== 'done')
    .reduce((total, step) => total + step.costEstimate, 0);

  return (
    <>
      <div className="page-head">
        <h1>What this actually costs</h1>
        <p className="lede">
          Every paid item on the path, what it buys, and what you have already spent. Almost everything else on this
          site is free — the money is concentrated in exam vouchers.
        </p>
      </div>

      <div className="card card-pad no-print" style={{ marginBottom: '1.25rem' }}>
        <label htmlFor="budget-path">Path</label>
        <select id="budget-path" value={pathId} onChange={(e) => setPathId(e.target.value)}>
          {paths.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-auto" style={{ marginBottom: '1.25rem' }}>
        <Stat value={money(path.totals.requiredCost)} label="Required total" />
        <Stat value={money(path.totals.totalCost)} label="Including optional" />
        <Stat value={dollars(spentOnPath)} label="You've spent" />
        <Stat value={money(remainingRequired)} label="Still to pay" />
      </div>

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Paid step</th>
                <th scope="col">Cost</th>
                <th scope="col">Status</th>
                <th scope="col">Why it costs money</th>
              </tr>
            </thead>
            <tbody>
              {paidSteps.map((step) => {
                const record = progressByStep.get(step.id);
                return (
                  <tr key={step.id}>
                    <th scope="row">
                      <Link to={`/paths/${path.id}`}>{step.title}</Link>
                      {step.optional && <span className="tag" style={{ marginLeft: '0.4rem' }}>Optional</span>}
                    </th>
                    <td className="nowrap">{money(step.costEstimate)}</td>
                    <td className="nowrap">
                      {record?.status === 'done' ? (
                        <span className="tag tag-done">Paid {dollars(record.costSpent)}</span>
                      ) : (
                        <span className="tag">Not yet</span>
                      )}
                    </td>
                    <td className="small muted">{step.costNote}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: '1.25rem' }}>
        <h2>Ways to pay less</h2>
        <ul className="small">
          <li>
            <strong>Coursera Financial Aid</strong> — applies to every Google certificate on this site and is routinely
            approved. Apply and wait about two weeks rather than paying $49/month.
          </li>
          <li>
            <strong>CompTIA partner vouchers</strong> — authorized training partners resell vouchers 10–20% below
            retail. Never pay list price on comptia.org without checking.
          </li>
          <li>
            <strong>Workforce grants</strong> — US WIOA funding through your local American Job Center covers IT
            certification costs for eligible adults, including people currently employed in low-wage work. This is the
            single most overlooked source of free cert money.
          </li>
          <li>
            <strong>Veterans</strong> — VA benefits reimburse certification test fees, including CompTIA and Cisco exams.
          </li>
          <li>
            <strong>Employer tuition assistance</strong> — many large retailers and warehouse employers offer education
            benefits that cover certifications. Check the benefits portal before spending your own money.
          </li>
          <li>
            <strong>Public library cards</strong> — many US library systems include free LinkedIn Learning, Gale
            Courses, or O'Reilly access with a card.
          </li>
        </ul>
      </div>
    </>
  );
}
