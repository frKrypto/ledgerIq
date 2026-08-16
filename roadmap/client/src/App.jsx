import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useApp } from './lib/store.jsx';
import { Layout } from './components/Layout.jsx';
import { Login } from './pages/Login.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Paths } from './pages/Paths.jsx';
import { PathDetail } from './pages/PathDetail.jsx';
import { Compare } from './pages/Compare.jsx';
import { Quiz } from './pages/Quiz.jsx';
import { Schedule } from './pages/Schedule.jsx';
import { Budget } from './pages/Budget.jsx';
import { Library } from './pages/Library.jsx';
import { PivotMap } from './pages/PivotMap.jsx';
import { Shared } from './pages/Shared.jsx';
import { Profile } from './pages/Profile.jsx';
import { Portfolio } from './pages/Portfolio.jsx';
import { PrintView } from './pages/PrintView.jsx';

function RequireAuth({ children }) {
  const { user, booting } = useApp();
  const location = useLocation();
  if (booting) return <div className="empty">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export function App() {
  const { booting, user } = useApp();

  return (
    <Routes>
      {/* Public: a portfolio link has to work for someone with no account. */}
      <Route path="/p/:slug" element={<Portfolio />} />
      <Route path="/login" element={booting ? <div className="empty">Loading…</div> : user ? <Navigate to="/" replace /> : <Login />} />

      <Route
        path="/print/:pathId"
        element={
          <RequireAuth>
            <PrintView />
          </RequireAuth>
        }
      />

      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/paths" element={<Paths />} />
        <Route path="/paths/:pathId" element={<PathDetail />} />
        <Route path="/compare" element={<Compare />} />
        <Route path="/quiz" element={<Quiz />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/budget" element={<Budget />} />
        <Route path="/library" element={<Library />} />
        <Route path="/map" element={<PivotMap />} />
        <Route path="/shared" element={<Shared />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
