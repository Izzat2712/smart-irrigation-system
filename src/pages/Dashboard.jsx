import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { onValue, ref, set } from "firebase/database";
import { auth, db } from "../firebase";

function Dashboard({ user, onLocalDevLogout }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [sensorData, setSensorData] = useState(null);
  const [decisionData, setDecisionData] = useState(null);
  const [pumpStatus, setPumpStatus] = useState("Unknown");
  const [controlMode, setControlMode] = useState("MANUAL");
  const [pumpLoading, setPumpLoading] = useState(false);
  const [historyRecords, setHistoryRecords] = useState([]);
  const [activeHistoryTab, setActiveHistoryTab] = useState("records");
  const [selectedHistoryDay, setSelectedHistoryDay] = useState(1);
  const [selectedGraphType, setSelectedGraphType] = useState("pump");

  useEffect(() => {
    const sensorRef = ref(db, "device1/sensorData");
    const decisionRef = ref(db, "device1/decision");
    const pumpRef = ref(db, "device1/control/pump");
    const modeRef = ref(db, "device1/control/mode");
    const historyRef = ref(db, "device1/history");

    const getSortableTimestamp = (timestamp) => {
      if (typeof timestamp === "number") {
        return timestamp > 0 ? timestamp : 0;
      }

      const parsed = new Date(timestamp || 0).getTime();
      return Number.isNaN(parsed) ? 0 : parsed;
    };

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
          const firstTime = getSortableTimestamp(b.timestamp);
          const secondTime = getSortableTimestamp(a.timestamp);

          if (firstTime !== secondTime) {
            return firstTime - secondTime;
          }

          return b.id.localeCompare(a.id);
        });
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
      if (user?.isLocalDev) {
        onLocalDevLogout();
      } else {
        await signOut(auth);
      }

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

  const getComparableTimestamp = (timestamp) => {
    if (typeof timestamp === "number") {
      return timestamp > 0 ? timestamp : 0;
    }

    const parsed = new Date(timestamp || 0).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const latestHistoryRecord = historyRecords[0] || null;
  const displaySensorData =
    latestHistoryRecord &&
    getComparableTimestamp(latestHistoryRecord.timestamp) >
      getComparableTimestamp(sensorData?.timestamp)
      ? latestHistoryRecord
      : sensorData;

  const airTemp = toNumberOrNull(displaySensorData?.airTemp);
  const leafTemp = toNumberOrNull(displaySensorData?.leafTemp);
  const soilMoisture = toNumberOrNull(displaySensorData?.soilMoisture);
  const light =
    typeof displaySensorData?.light === "string" ? displaySensorData.light : null;

  const hasDecisionInputs =
    airTemp !== null &&
    leafTemp !== null &&
    soilMoisture !== null &&
    Boolean(light);

  const calculatedDeltaT = hasDecisionInputs ? leafTemp - airTemp : null;
  const isHighDeltaT = calculatedDeltaT !== null ? calculatedDeltaT >= 3 : false;
  const isLowSoilMoisture = soilMoisture !== null ? soilMoisture < 40 : false;
  const normalizedLight = light?.toUpperCase();
  const isNightLight = normalizedLight === "NIGHT";
  const isDayLight = ["DAY", "LOW_LIGHT", "BRIGHT", "STRONG_DAYLIGHT"].includes(
    normalizedLight
  );

  let calculatedPlantStatus = "--";
  let calculatedRecommendation = "WAITING_FOR_SENSOR_DATA";

  if (hasDecisionInputs) {
    calculatedPlantStatus = isHighDeltaT ? "Stressed" : "Healthy";

    if (isHighDeltaT && isLowSoilMoisture && isNightLight) {
      calculatedRecommendation = "WATER_NOW";
    } else if (isHighDeltaT && isLowSoilMoisture && isDayLight) {
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

  const isLegacyUptimeTimestamp = (timestamp) =>
    typeof timestamp === "number" && timestamp > 0 && timestamp < 946684800000;

  const formatDateTime = (date) =>
    date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const knownUptimeTimestamps = [
    sensorData?.timestamp,
    ...historyRecords.map((record) => record.timestamp),
  ].filter(isLegacyUptimeTimestamp);

  const latestKnownUptime =
    knownUptimeTimestamps.length > 0 ? Math.max(...knownUptimeTimestamps) : null;

  const formatEstimatedTimestamp = (timestamp) => {
    if (!latestKnownUptime) {
      return `Estimated ${formatDateTime(new Date())}`;
    }

    const deviceBootEstimate = Date.now() - latestKnownUptime;
    const estimatedDate = new Date(deviceBootEstimate + timestamp);

    return `Estimated ${formatDateTime(estimatedDate)}`;
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) {
      return "--";
    }

    if (isLegacyUptimeTimestamp(timestamp)) {
      return formatEstimatedTimestamp(timestamp);
    }

    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
      return timestamp;
    }

    return formatDateTime(date);
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

  const dayTabs = [
    { value: 1, label: "Monday", offset: 0 },
    { value: 2, label: "Tuesday", offset: 1 },
    { value: 3, label: "Wednesday", offset: 2 },
    { value: 4, label: "Thursday", offset: 3 },
    { value: 5, label: "Friday", offset: 4 },
    { value: 6, label: "Saturday", offset: 5 },
    { value: 0, label: "Sunday", offset: 6 },
  ];

  const graphTypes = [
    { value: "pump", label: "Pump Activity" },
    { value: "soilMoisture", label: "Soil Moisture" },
    { value: "leafTemp", label: "Leaf Temperature" },
    { value: "deltaT", label: "Delta T" },
  ];

  const getRecordDate = (timestamp) => {
    if (!timestamp || isLegacyUptimeTimestamp(timestamp)) {
      return null;
    }

    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const getHistoryWindowBaseDate = (date) => {
    const shiftedDate = new Date(date);
    shiftedDate.setHours(shiftedDate.getHours() - 8);
    return shiftedDate;
  };

  const getHistoryWindowHour = (date) => {
    const hour = date.getHours() + date.getMinutes() / 60;
    return hour >= 8 ? hour - 8 : hour + 16;
  };

  const addDays = (date, days) => {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + days);
    return nextDate;
  };

  const getWeekStart = (date) => {
    const baseDate = getHistoryWindowBaseDate(date);
    const mondayOffset = (baseDate.getDay() + 6) % 7;
    const weekStart = addDays(baseDate, -mondayOffset);
    weekStart.setHours(8, 0, 0, 0);
    return weekStart;
  };

  const formatShortDate = (date) =>
    date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
    });

  const formatWindowDateTime = (date) =>
    date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  const getRecordPumpValue = (record) => {
    const value = String(
      record.pump ?? record.pumpStatus ?? record.controlPump ?? ""
    ).toUpperCase();

    if (value === "ON" || value === "1" || value === "TRUE") {
      return 1;
    }

    if (value === "OFF" || value === "0" || value === "FALSE") {
      return 0;
    }

    return null;
  };

  const getRecordMode = (record) =>
    record.mode ?? record.controlMode ?? record.pumpMode ?? record.irrigationMode ?? null;

  const getRecordDeltaT = (record) => {
    const savedDeltaT = toNumberOrNull(record.deltaT);

    if (savedDeltaT !== null) {
      return savedDeltaT;
    }

    const recordLeafTemp = toNumberOrNull(record.leafTemp);
    const recordAirTemp = toNumberOrNull(record.airTemp);

    if (recordLeafTemp === null || recordAirTemp === null) {
      return null;
    }

    return recordLeafTemp - recordAirTemp;
  };

  const getGraphValue = (record, graphType) => {
    if (graphType === "pump") {
      return getRecordPumpValue(record);
    }

    if (graphType === "deltaT") {
      return getRecordDeltaT(record);
    }

    return toNumberOrNull(record[graphType]);
  };

  const selectedGraph = graphTypes.find(
    (graphType) => graphType.value === selectedGraphType
  );
  const validHistoryDates = historyRecords
    .map((record) => getRecordDate(record.timestamp))
    .filter(Boolean);
  const latestHistoryDate =
    validHistoryDates.length > 0
      ? new Date(Math.max(...validHistoryDates.map((date) => date.getTime())))
      : new Date();
  const graphWeekStart = getWeekStart(latestHistoryDate);
  const datedDayTabs = dayTabs.map((day) => {
    const windowStart = addDays(graphWeekStart, day.offset);
    const windowEnd = addDays(windowStart, 1);

    return {
      ...day,
      dateLabel: formatShortDate(windowStart),
      windowStart,
      windowEnd,
    };
  });
  const selectedHistoryDayTab =
    datedDayTabs.find((day) => day.value === selectedHistoryDay) ||
    datedDayTabs[0];
  const selectedHistoryDayLabel = selectedHistoryDayTab?.label || "Monday";
  const selectedHistoryWindowLabel = selectedHistoryDayTab
    ? `${formatWindowDateTime(selectedHistoryDayTab.windowStart)} to ${formatWindowDateTime(
        selectedHistoryDayTab.windowEnd
      )}`
    : "8:00 AM to next-day 8:00 AM";

  const graphRecords = historyRecords
    .map((record) => {
      const date = getRecordDate(record.timestamp);

      if (!date) {
        return null;
      }

      return {
        ...record,
        date,
        windowHour: getHistoryWindowHour(date),
      };
    })
    .filter(
      (record) =>
        record &&
        selectedHistoryDayTab &&
        record.date >= selectedHistoryDayTab.windowStart &&
        record.date < selectedHistoryDayTab.windowEnd &&
        getGraphValue(record, selectedGraphType) !== null
    )
    .sort((a, b) => a.windowHour - b.windowHour);

  const graphValues = graphRecords.map((record) =>
    getGraphValue(record, selectedGraphType)
  );
  const graphAverage =
    graphValues.length > 0
      ? graphValues.reduce((total, value) => total + value, 0) / graphValues.length
      : null;
  const latestGraphRecord = graphRecords[graphRecords.length - 1] || null;
  const latestGraphValue = latestGraphRecord
    ? getGraphValue(latestGraphRecord, selectedGraphType)
    : null;
  const pumpOnCount = graphRecords.filter(
    (record) => getRecordPumpValue(record) === 1
  ).length;
  const pumpModeCounts = graphRecords.reduce(
    (counts, record) => {
      const mode = String(getRecordMode(record) || "").toUpperCase();

      if (mode === "AUTO") {
        return { ...counts, auto: counts.auto + 1 };
      }

      if (mode === "MANUAL") {
        return { ...counts, manual: counts.manual + 1 };
      }

      return counts;
    },
    { auto: 0, manual: 0 }
  );

  const graphUnit =
    selectedGraphType === "soilMoisture"
      ? "%"
      : selectedGraphType === "leafTemp" || selectedGraphType === "deltaT"
        ? "°C"
        : "";

  const formatGraphValue = (value) => {
    if (value === null || value === undefined) {
      return "--";
    }

    if (selectedGraphType === "pump") {
      return value === 1 ? "ON" : "OFF";
    }

    return `${Number(value).toFixed(1)} ${graphUnit}`;
  };

  const getDeltaTStatus = (value) => {
    if (value === null || value === undefined) {
      return "--";
    }

    return value >= 3 ? "Stressed" : "Healthy";
  };

  const renderHistoryGraph = () => {
    const width = 920;
    const height = 320;
    const padding = { top: 26, right: 28, bottom: 42, left: 54 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const values = graphRecords.map((record) =>
      getGraphValue(record, selectedGraphType)
    );
    const valueMin = selectedGraphType === "pump" ? 0 : Math.min(...values);
    const valueMax = selectedGraphType === "pump" ? 1 : Math.max(...values);
    const lowerBound =
      selectedGraphType === "soilMoisture"
        ? 0
        : selectedGraphType === "pump"
          ? 0
          : Math.floor(valueMin - 1);
    const upperBound =
      selectedGraphType === "soilMoisture"
        ? Math.max(100, valueMax)
        : selectedGraphType === "pump"
          ? 1
          : Math.ceil(valueMax + 1);
    const yRange = upperBound - lowerBound || 1;
    const getX = (windowHour) => padding.left + (windowHour / 24) * plotWidth;
    const getY = (value) =>
      padding.top + ((upperBound - value) / yRange) * plotHeight;
    const points = graphRecords.map((record) => {
      const value = getGraphValue(record, selectedGraphType);

      return {
        x: getX(record.windowHour),
        y: getY(value),
        value,
        record,
      };
    });
    const linePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
    const yTicks =
      selectedGraphType === "pump"
        ? [0, 1]
        : [lowerBound, lowerBound + yRange / 2, upperBound];
    const deltaThresholdY =
      selectedGraphType === "deltaT" && lowerBound <= 3 && upperBound >= 3
        ? getY(3)
        : null;

    return (
      <div className="chart-frame">
        {points.length > 0 ? (
          <svg
            className="history-chart"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${selectedGraph?.label} graph for ${selectedHistoryDayLabel}`}
          >
            <line
              className="chart-axis"
              x1={padding.left}
              x2={padding.left}
              y1={padding.top}
              y2={height - padding.bottom}
            />
            <line
              className="chart-axis"
              x1={padding.left}
              x2={width - padding.right}
              y1={height - padding.bottom}
              y2={height - padding.bottom}
            />

            {[0, 6, 12, 18, 24].map((hour) => {
              const x = getX(hour);
              const labelHour = (8 + hour) % 24 || 24;

              return (
                <g key={hour}>
                  <line
                    className="chart-grid-line"
                    x1={x}
                    x2={x}
                    y1={padding.top}
                    y2={height - padding.bottom}
                  />
                  <text className="chart-label" x={x} y={height - 14}>
                    {labelHour === 24 ? "12am" : `${labelHour}:00`}
                  </text>
                </g>
              );
            })}

            {yTicks.map((tick) => {
              const y = getY(tick);

              return (
                <g key={tick}>
                  <line
                    className="chart-grid-line"
                    x1={padding.left}
                    x2={width - padding.right}
                    y1={y}
                    y2={y}
                  />
                  <text className="chart-label chart-label-y" x={14} y={y + 4}>
                    {selectedGraphType === "pump"
                      ? tick
                      : `${tick.toFixed(1)}${graphUnit}`}
                  </text>
                </g>
              );
            })}

            {deltaThresholdY !== null ? (
              <g>
                <line
                  className="chart-threshold-line"
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={deltaThresholdY}
                  y2={deltaThresholdY}
                />
                <text
                  className="chart-threshold-label"
                  x={width - padding.right - 76}
                  y={deltaThresholdY - 8}
                >
                  Stress line
                </text>
              </g>
            ) : null}

            <polyline className="chart-line" points={linePoints} />

            {points.map((point) => (
              <g key={point.record.id}>
                <circle className="chart-point" cx={point.x} cy={point.y} r="5" />
                <title>
                  {`${formatTimestamp(point.record.timestamp)} - ${formatGraphValue(point.value)}`}
                </title>
              </g>
            ))}
          </svg>
        ) : (
          <div className="chart-empty">
            <p className="panel-value">No graph data for this day yet.</p>
            <p className="panel-subvalue">
              Records need valid timestamps and values for the selected graph.
            </p>
          </div>
        )}
      </div>
    );
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

          {displaySensorData ? (
            <div className="dashboard-grid">
              <div className="info-panel">
                <p className="panel-label">Air Temperature</p>
                <p className="panel-value">
                  {displaySensorData.airTemp ?? "--"} °C
                </p>
              </div>

              <div className="info-panel">
                <p className="panel-label">Humidity</p>
                <p className="panel-value">
                  {displaySensorData.humidity ?? "--"} %
                </p>
              </div>

              <div className="info-panel">
                <p className="panel-label">Leaf Temperature</p>
                <p className="panel-value">
                  {displaySensorData.leafTemp ?? "--"} °C
                </p>
              </div>

              <div className="info-panel">
                <p className="panel-label">Soil Moisture</p>
                <p className="panel-value">
                  {displaySensorData.soilMoisture ?? "--"} %
                </p>
              </div>

              <div className="info-panel">
                <p className="panel-label">Light</p>
                <p className="panel-value">{displaySensorData.light ?? "--"}</p>
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
                Records and daily graphs from `device1/history`.
              </p>
            </div>
            <span className="status-pill">
              {historyRecords.length} total{" "}
              {historyRecords.length === 1 ? "record" : "records"}
            </span>
          </div>

          <div className="tab-row" role="tablist" aria-label="History views">
            <button
              className={`tab-button ${activeHistoryTab === "records" ? "tab-button-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeHistoryTab === "records"}
              onClick={() => setActiveHistoryTab("records")}
            >
              History Record
            </button>
            <button
              className={`tab-button ${activeHistoryTab === "graphs" ? "tab-button-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeHistoryTab === "graphs"}
              onClick={() => setActiveHistoryTab("graphs")}
            >
              Daily Graphs
            </button>
          </div>

          {activeHistoryTab === "records" ? (
            historyRecords.length > 0 ? (
            <div className="history-list">
              {historyRecords.map((record) => (
                <div className="info-panel" key={record.id}>
                  <p className="panel-label">Timestamp</p>
                  <p className="panel-value">
                    {formatTimestamp(record.timestamp)}
                  </p>

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
            )
          ) : (
            <div className="history-graph-panel">
              <div className="graph-control-group">
                <p className="panel-label">Day</p>
                <div className="tab-row tab-row-compact" role="tablist" aria-label="Graph days">
                  {datedDayTabs.map((day) => (
                    <button
                      className={`tab-button ${selectedHistoryDay === day.value ? "tab-button-active" : ""}`}
                      type="button"
                      role="tab"
                      aria-selected={selectedHistoryDay === day.value}
                      key={day.value}
                      onClick={() => setSelectedHistoryDay(day.value)}
                    >
                      <span className="tab-button-main">{day.label}</span>
                      <span className="tab-button-sub">{day.dateLabel}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="graph-control-group">
                <label className="field-label" htmlFor="history-graph-type">
                  Graph
                </label>
                <select
                  className="field-input graph-select"
                  id="history-graph-type"
                  value={selectedGraphType}
                  onChange={(event) => setSelectedGraphType(event.target.value)}
                >
                  {graphTypes.map((graphType) => (
                    <option key={graphType.value} value={graphType.value}>
                      {graphType.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="graph-summary-grid">
                <div className="info-panel">
                  <p className="panel-label">Window</p>
                  <p className="panel-value">
                    {selectedHistoryDayLabel} {selectedHistoryDayTab?.dateLabel}
                  </p>
                  <p className="panel-subvalue">{selectedHistoryWindowLabel}</p>
                </div>

                <div className="info-panel">
                  <p className="panel-label">Selected Graph</p>
                  <p className="panel-value">{selectedGraph?.label}</p>
                  <p className="panel-subvalue">
                    {graphRecords.length} plotted{" "}
                    {graphRecords.length === 1 ? "record" : "records"}
                  </p>
                </div>

                {selectedGraphType === "pump" ? (
                  <div className="info-panel">
                    <p className="panel-label">Pump On Frequency</p>
                    <p className="panel-value">
                      {pumpOnCount} / {graphRecords.length || 0}
                    </p>
                    <p className="panel-subvalue">
                      AUTO {pumpModeCounts.auto} - MANUAL {pumpModeCounts.manual}
                    </p>
                  </div>
                ) : selectedGraphType === "deltaT" ? (
                  <div className="info-panel">
                    <p className="panel-label">Latest Status</p>
                    <p className="panel-value">
                      {getDeltaTStatus(latestGraphValue)}
                    </p>
                    <p className="panel-subvalue">
                      Latest Delta T: {formatGraphValue(latestGraphValue)}
                    </p>
                  </div>
                ) : (
                  <div className="info-panel">
                    <p className="panel-label">Average</p>
                    <p className="panel-value">
                      {formatGraphValue(graphAverage)}
                    </p>
                    <p className="panel-subvalue">
                      Latest: {formatGraphValue(latestGraphValue)}
                    </p>
                  </div>
                )}
              </div>

              {renderHistoryGraph()}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default Dashboard;
