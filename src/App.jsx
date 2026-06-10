import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import "./App.css";

const localDevUser = {
  email: "local-dev@smart-irrigation.test",
  isLocalDev: true,
};

function isLocalDevSessionEnabled() {
  return import.meta.env.DEV && localStorage.getItem("localDevAuth") === "true";
}

function ProtectedRoute({ user, loading, children }) {
  if (loading) {
    return (
      <div className="page-shell">
        <div className="auth-card">
          <p className="status-text">Checking your session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function PublicRoute({ user, loading, children }) {
  if (loading) {
    return (
      <div className="page-shell">
        <div className="auth-card">
          <p className="status-text">Loading authentication...</p>
        </div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

function App() {
  const [user, setUser] = useState(() =>
    isLocalDevSessionEnabled() ? localDevUser : null,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser || (isLocalDevSessionEnabled() ? localDevUser : null));
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLocalDevLogin = () => {
    localStorage.setItem("localDevAuth", "true");
    setUser(localDevUser);
  };

  const handleLocalDevLogout = () => {
    localStorage.removeItem("localDevAuth");
    setUser(null);
  };

  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to={user ? "/dashboard" : "/login"} replace />}
      />
      <Route
        path="/login"
        element={
          <PublicRoute user={user} loading={loading}>
            <Login onLocalDevLogin={handleLocalDevLogin} />
          </PublicRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicRoute user={user} loading={loading}>
            <Register onLocalDevLogin={handleLocalDevLogin} />
          </PublicRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute user={user} loading={loading}>
            <Dashboard user={user} onLocalDevLogout={handleLocalDevLogout} />
          </ProtectedRoute>
        }
      />
      <Route
        path="*"
        element={<Navigate to={user ? "/dashboard" : "/login"} replace />}
      />
    </Routes>
  );
}

export default App;
