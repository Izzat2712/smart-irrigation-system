import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";

function Dashboard({ user }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);

    try {
      await signOut(auth);
      navigate("/login");
    } catch (error) {
      console.error("Logout failed:", error);
      setLoading(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="dashboard-card">
        <div className="dashboard-header">
          <div>
            <span className="brand-tag">Smart Irrigation Dashboard</span>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">
              Your Firebase authentication is active and ready for demo use.
            </p>
          </div>

          <button
            className="ghost-button"
            type="button"
            onClick={handleLogout}
            disabled={loading}
          >
            {loading ? "Logging out..." : "Logout"}
          </button>
        </div>

        <div className="dashboard-grid">
          <div className="info-panel">
            <p className="panel-label">Signed in as</p>
            <p className="panel-value">{user?.email || "No email available"}</p>
          </div>

          <div className="info-panel">
            <p className="panel-label">Authentication status</p>
            <p className="panel-value">Connected to Firebase Auth</p>
          </div>

          <div className="info-panel">
            <p className="panel-label">Project purpose</p>
            <p className="panel-value">Smart irrigation monitoring demo</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
