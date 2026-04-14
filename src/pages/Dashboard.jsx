import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { onValue, ref, set } from "firebase/database";
import { auth, db } from "../firebase";

function Dashboard({ user }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [sensorData, setSensorData] = useState(null);
  const [decisionData, setDecisionData] = useState(null);
  const [pumpStatus, setPumpStatus] = useState("Unknown");
  const [controlMode, setControlMode] = useState("MANUAL");
  const [pumpLoading, setPumpLoading] = useState(false);
  const [historyRecords, setHistoryRecords] = useState([]);

  useEffect(() => {
    const sensorRef = ref(db, "device1/sensorData");
    const decisionRef = ref(db, "device1/decision");
    const pumpRef = ref(db, "device1/control/pump");
    const modeRef = ref(db, "device1/control/mode");
    const historyRef = ref(db, "device1/history");

    const normalizeHistory = (data) => {
      if (!data) {
        return [];
      }

      return Object.entries(data)
        .map(([id, value]) => ({
          id,
          ...value,
        }))
        .sort((a, b) => {
          const firstTime = new Date(b.timestamp || 0).getTime();
          const secondTime = new Date(a.timestamp || 0).getTime();
          return firstTime - secondTime;
        })
        .slice(0, 5);
    };

    const unsubscribeSensor = onValue(sensorRef, (snapshot) => {
      setSensorData(snapshot.val());
    });

    const unsubscribeDecision = onValue(decisionRef, (snapshot) => {
      setDecisionData(snapshot.val());
    });

    const unsubscribePump = onValue(pumpRef, (snapshot) => {
      setPumpStatus(snapshot.val() || "OFF");
    });

    const unsubscribeMode = onValue(modeRef, (snapshot) => {
      setControlMode(snapshot.val() || "MANUAL");
    });

    const unsubscribeHistory = onValue(historyRef, (snapshot) => {
      setHistoryRecords(normalizeHistory(snapshot.val()));
    });

    return () => {
      unsubscribeSensor();
      unsubscribeDecision();
      unsubscribePump();
      unsubscribeMode();
      unsubscribeHistory();
    };
  }, []);

  const handlePumpControl = async (status) => {
    if (controlMode !== "MANUAL") {
      return;
    }

    setPumpLoading(true);

    try {
      await set(ref(db, "device1/control/pump"), status);
    } catch (error) {
      console.error("Failed to update pump status:", error);
    } finally {
      setPumpLoading(false);
    }
  };

  const handleModeChange = async (mode) => {
    setPumpLoading(true);

    try {
      await set(ref(db, "device1/control/mode"), mode);
    } catch (error) {
      console.error("Failed to update control mode:", error);
    } finally {
      setPumpLoading(false);
    }
  };

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

  const toNumberOrNull = (value) => {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const airTemp = toNumberOrNull(sensorData?.airTemp);
  const leafTemp = toNumberOrNull(sensorData?.leafTemp);
  const soilMoisture = toNumberOrNull(sensorData?.soilMoisture);
  const light = typeof sensorData?.light === "string" ? sensorData.light : null;

  const hasDecisionInputs =
    airTemp !== null &&
    leafTemp !== null &&
    soilMoisture !== null &&
    Boolean(light);

  const calculatedDeltaT = hasDecisionInputs ? leafTemp - airTemp : null;
  const isHighDeltaT = calculatedDeltaT !== null ? calculatedDeltaT >= 3 : false;
  const isLowSoilMoisture = soilMoisture !== null ? soilMoisture < 40 : false;

  let calculatedPlantStatus = "--";
  let calculatedRecommendation = "WAITING_FOR_SENSOR_DATA";

  if (hasDecisionInputs) {
    calculatedPlantStatus = isHighDeltaT ? "Stressed" : "Healthy";

    if (isHighDeltaT && isLowSoilMoisture && light === "NIGHT") {
      calculatedRecommendation = "WATER_NOW";
    } else if (isHighDeltaT && isLowSoilMoisture && light === "DAY") {
      calculatedRecommendation = "WAIT_UNTIL_NIGHT";
    } else if (isHighDeltaT && !isLowSoilMoisture) {
      calculatedRecommendation = "DO_NOT_IRRIGATE";
    } else if (!isHighDeltaT && isLowSoilMoisture) {
      calculatedRecommendation = "MONITOR_DELAY_IRRIGATION";
    } else {
      calculatedRecommendation = "NO_IRRIGATION_NEEDED";
    }
  }

  const activeDeltaT =
    calculatedDeltaT !== null ? calculatedDeltaT : toNumberOrNull(decisionData?.deltaT);
  const activePlantStatus =
    calculatedPlantStatus !== "--"
      ? calculatedPlantStatus
      : decisionData?.plantStatus || "--";
  const activeRecommendation =
    calculatedRecommendation !== "WAITING_FOR_SENSOR_DATA"
      ? calculatedRecommendation
      : decisionData?.recommendation || "WAITING_FOR_SENSOR_DATA";

  useEffect(() => {
    const syncDecisionAndAutoPump = async () => {
      if (!hasDecisionInputs || calculatedDeltaT === null) {
        return;
      }

      try {
        await set(ref(db, "device1/decision"), {
          deltaT: Number(calculatedDeltaT.toFixed(1)),
          plantStatus: calculatedPlantStatus,
          recommendation: calculatedRecommendation,
          timestamp: new Date().toISOString(),
        });

        if (controlMode === "AUTO") {
          const nextPumpStatus =
            calculatedRecommendation === "WATER_NOW" ? "ON" : "OFF";

          if (nextPumpStatus !== pumpStatus) {
            await set(ref(db, "device1/control/pump"), nextPumpStatus);
          }
        }
      } catch (error) {
        console.error("Failed to sync decision data:", error);
      }
    };

    syncDecisionAndAutoPump();
  }, [
    calculatedDeltaT,
    calculatedPlantStatus,
    calculatedRecommendation,
    controlMode,
    hasDecisionInputs,
    pumpStatus,
  ]);

  const formatTimestamp = (timestamp) => {
    if (!timestamp) {
      return "--";
    }

    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
      return timestamp;
    }

    return date.toLocaleString();
  };

  const formatRecommendation = (value) => {
    if (!value) {
      return "--";
    }

    return value
      .split("_")
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(" ");
  };

  return (
    <div className="page-shell">
      <div className="dashboard-card">
        <div className="dashboard-header">
          <div className="dashboard-intro">
            <span className="brand-tag">Smart Irrigation Dashboard</span>
            <h1 className="page-title">Control Center</h1>
            <p className="page-subtitle">
              Live field conditions, irrigation decisions, and pump controls in
              one place.
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

        <div className="dashboard-top-grid">
          <div className="info-panel">
            <p className="panel-label">Signed in as</p>
            <p className="panel-value">{user?.email || "No email available"}</p>
          </div>

          <div className="info-panel">
            <p className="panel-label">Authentication</p>
            <p className="panel-value">Connected to Firebase Auth</p>
            <p className="panel-subvalue">Session is active and protected.</p>
          </div>

          <div className="info-panel info-panel-accent">
            <p className="panel-label">System Recommendation</p>
            <p className="panel-value">
              {formatRecommendation(activeRecommendation)}
            </p>
            <p className="panel-subvalue">
              Plant status: {activePlantStatus}
              {activeDeltaT !== null
                ? ` • Delta T ${activeDeltaT.toFixed(1)} °C`
                : ""}
            </p>
          </div>
        </div>

        <section className="dashboard-section">
          <div className="section-header">
            <div>
              <h2 className="section-title">Sensor Data</h2>
              <p className="section-kicker">
                Realtime environmental readings from Firebase.
              </p>
            </div>
            <span className="status-pill">Live feed</span>
          </div>

          {sensorData ? (
            <div className="dashboard-grid">
              <div className="info-panel">
                <p className="panel-label">Air Temperature</p>
                <p className="panel-value">{sensorData.airTemp ?? "--"} °C</p>
              </div>

              <div className="info-panel">
                <p className="panel-label">Humidity</p>
                <p className="panel-value">{sensorData.humidity ?? "--"} %</p>
              </div>

              <div className="info-panel">
                <p className="panel-label">Leaf Temperature</p>
                <p className="panel-value">{sensorData.leafTemp ?? "--"} °C</p>
              </div>

              <div className="info-panel">
                <p className="panel-label">Soil Moisture</p>
                <p className="panel-value">{sensorData.soilMoisture ?? "--"} %</p>
              </div>

              <div className="info-panel">
                <p className="panel-label">Light</p>
                <p className="panel-value">{sensorData.light ?? "--"}</p>
              </div>
            </div>
          ) : (
            <div className="info-panel">
              <p className="panel-value">No sensor data available yet.</p>
            </div>
          )}
        </section>

        <section className="dashboard-section">
          <div className="section-header">
            <div>
              <h2 className="section-title">Pump Control</h2>
              <p className="section-kicker">
                Switch between automatic irrigation and manual override.
              </p>
            </div>
            <span className="status-pill">Mode: {controlMode}</span>
          </div>

          <div className="dashboard-grid">
            <div className="info-panel">
              <p className="panel-label">Current Mode</p>
              <p className="panel-value">{controlMode}</p>
              <p className="panel-subvalue">
                AUTO follows the smart recommendation. MANUAL lets you control
                the pump yourself.
              </p>
            </div>

            <div className="info-panel">
              <p className="panel-label">Mode Selection</p>
              <p className="panel-subvalue">
                Choose how the irrigation system should behave.
              </p>
              <div className="actions-row">
                <button
                  className={`mode-button ${controlMode === "AUTO" ? "mode-button-auto-active" : "pump-button-default"}`}
                  type="button"
                  onClick={() => handleModeChange("AUTO")}
                  disabled={pumpLoading}
                >
                  AUTO
                </button>

                <button
                  className={`mode-button ${controlMode === "MANUAL" ? "mode-button-manual-active" : "pump-button-default"}`}
                  type="button"
                  onClick={() => handleModeChange("MANUAL")}
                  disabled={pumpLoading}
                >
                  MANUAL
                </button>
              </div>
            </div>

            <div className="info-panel">
              <p className="panel-label">Current Pump Status</p>
              <p className="panel-value">{pumpStatus}</p>
              <p className="panel-subvalue">
                Commands are written to `device1/control/pump`.
              </p>
            </div>

            <div className="info-panel">
              <p className="panel-label">Control Actions</p>
              <p className="panel-subvalue">
                Manual buttons only work when mode is set to MANUAL.
              </p>
              <div className="actions-row">
                <button
                  className={`pump-button ${pumpStatus === "ON" ? "pump-button-on-active" : "pump-button-default"}`}
                  type="button"
                  onClick={() => handlePumpControl("ON")}
                  disabled={pumpLoading || controlMode !== "MANUAL"}
                >
                  Turn Pump ON
                </button>

                <button
                  className={`pump-button ${pumpStatus === "OFF" ? "pump-button-off-active" : "pump-button-default"}`}
                  type="button"
                  onClick={() => handlePumpControl("OFF")}
                  disabled={pumpLoading || controlMode !== "MANUAL"}
                >
                  Turn Pump OFF
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="dashboard-section">
          <div className="section-header">
            <div>
              <h2 className="section-title">Smart Decision</h2>
              <p className="section-kicker">
                A simple stress model based on Delta T, soil moisture, and
                light.
              </p>
            </div>
            <span className="status-pill">{activePlantStatus}</span>
          </div>

          <div className="dashboard-grid">
            <div className="info-panel">
              <p className="panel-label">Delta T</p>
              <p className="panel-value">
                {activeDeltaT !== null ? `${activeDeltaT.toFixed(1)} °C` : "--"}
              </p>
              <p className="panel-subvalue">Calculated as leafTemp - airTemp.</p>
            </div>

            <div className="info-panel">
              <p className="panel-label">Plant Status</p>
              <p className="panel-value">{activePlantStatus}</p>
              <p className="panel-subvalue">
                {calculatedDeltaT !== null
                  ? isHighDeltaT
                    ? "Leaf temperature is elevated."
                    : "Stress level is currently low."
                  : "Using the latest saved decision from Firebase."}
              </p>
            </div>

            <div className="info-panel info-panel-accent">
              <p className="panel-label">Recommendation</p>
              <p className="panel-value">
                {formatRecommendation(activeRecommendation)}
              </p>
              <p className="panel-subvalue">
                Visible in both AUTO and MANUAL modes.
              </p>
            </div>
          </div>
        </section>

        <section className="dashboard-section">
          <div className="section-header">
            <div>
              <h2 className="section-title">History</h2>
              <p className="section-kicker">
                Most recent records from `device1/history`.
              </p>
            </div>
            <span className="status-pill">
              {historyRecords.length} recent{" "}
              {historyRecords.length === 1 ? "record" : "records"}
            </span>
          </div>

          {historyRecords.length > 0 ? (
            <div className="history-list">
              {historyRecords.map((record) => (
                <div className="info-panel" key={record.id}>
                  <p className="panel-label">Timestamp</p>
                  <p className="panel-value">{formatTimestamp(record.timestamp)}</p>

                  <div className="history-meta">
                    <div>
                      <p className="panel-label">Air Temp</p>
                      <p className="panel-value">{record.airTemp ?? "--"} °C</p>
                    </div>

                    <div>
                      <p className="panel-label">Leaf Temp</p>
                      <p className="panel-value">{record.leafTemp ?? "--"} °C</p>
                    </div>

                    <div>
                      <p className="panel-label">Humidity</p>
                      <p className="panel-value">{record.humidity ?? "--"} %</p>
                    </div>

                    <div>
                      <p className="panel-label">Soil Moisture</p>
                      <p className="panel-value">
                        {record.soilMoisture ?? "--"} %
                      </p>
                    </div>

                    <div>
                      <p className="panel-label">Light</p>
                      <p className="panel-value">{record.light ?? "--"}</p>
                    </div>

                    <div>
                      <p className="panel-label">Pump</p>
                      <p className="panel-value">{record.pump ?? "--"}</p>
                    </div>

                    <div className="info-panel-wide">
                      <p className="panel-label">Recommendation</p>
                      <p className="panel-value">
                        {formatRecommendation(record.recommendation)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="info-panel">
              <p className="panel-value">No history records available yet.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default Dashboard;
