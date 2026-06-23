import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { onValue, push, ref, set, update } from "firebase/database";
import { auth, db } from "../firebase";

const REAL_TIMESTAMP_MIN = 946684800000;
const LOW_SOIL_MOISTURE_THRESHOLD = 60;
const DEFAULT_LIGHT_OPTIONS = ["NIGHT", "LOW_LIGHT", "BRIGHT", "STRONG_DAYLIGHT"];

const getDateTimeInputValue = (timestamp = Date.now()) => {
  const date = new Date(timestamp);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (value) => String(value).padStart(2, "0");

  return `${safeDate.getFullYear()}-${pad(safeDate.getMonth() + 1)}-${pad(
    safeDate.getDate(),
  )}T${pad(safeDate.getHours())}:${pad(safeDate.getMinutes())}`;
};

const roundToOneDecimal = (value) => Number(value.toFixed(1));

const isLegacyUptimeTimestamp = (timestamp) =>
  typeof timestamp === "number" && timestamp > 0 && timestamp < REAL_TIMESTAMP_MIN;

const hasRealTimestamp = (timestamp) => {
  if (typeof timestamp === "number") {
    return timestamp >= REAL_TIMESTAMP_MIN;
  }

  const parsed = new Date(timestamp || 0).getTime();
  return !Number.isNaN(parsed) && parsed >= REAL_TIMESTAMP_MIN;
};

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
  const [showHistoryManagementFeatures, setShowHistoryManagementFeatures] =
    useState(true);
  const [newHistoryForm, setNewHistoryForm] = useState({
    timestamp: getDateTimeInputValue(),
    soilMoisture: "",
    light: "BRIGHT",
    pump: "OFF",
  });
  const [editingRecordId, setEditingRecordId] = useState(null);
  const [editHistoryForm, setEditHistoryForm] = useState(null);
  const [historySaveLoading, setHistorySaveLoading] = useState(false);
  const [historyDeleteLoading, setHistoryDeleteLoading] = useState(false);
  const [historyFormStatus, setHistoryFormStatus] = useState(null);
  const [historyFilterStartDate, setHistoryFilterStartDate] = useState("");
  const [historyFilterEndDate, setHistoryFilterEndDate] = useState("");
  const [selectedHistoryRecordIds, setSelectedHistoryRecordIds] = useState([]);

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
        .filter((record) => hasRealTimestamp(record.timestamp))
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
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const displaySensorData = sensorData;

  const airTemp = toNumberOrNull(displaySensorData?.airTemp);
  const leafTemp = toNumberOrNull(displaySensorData?.leafTemp);
  const soilMoisture = toNumberOrNull(displaySensorData?.soilMoisture);
  const light =
    typeof displaySensorData?.light === "string" ? displaySensorData.light : null;
  const normalizedLight = light?.toUpperCase();

  const hasDecisionInputs = soilMoisture !== null && Boolean(normalizedLight);

  const calculatedDeltaT =
    airTemp !== null && leafTemp !== null ? leafTemp - airTemp : null;
  const isLowSoilMoisture =
    soilMoisture !== null ? soilMoisture < LOW_SOIL_MOISTURE_THRESHOLD : false;
  const isNightLight = normalizedLight === "NIGHT";

  let calculatedPlantStatus = "--";
  let calculatedRecommendation = "WAITING_FOR_SENSOR_DATA";

  if (hasDecisionInputs) {
    calculatedPlantStatus = isLowSoilMoisture ? "Needs Water" : "Moisture OK";

    if (isLowSoilMoisture && isNightLight) {
      calculatedRecommendation = "WATER_NOW";
    } else if (isLowSoilMoisture && !isNightLight) {
      calculatedRecommendation = "WAIT_UNTIL_NIGHT";
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

  const liveHumidity = toNumberOrNull(displaySensorData?.humidity);

  const getAutomatedHistoryDecision = ({
    recordAirTemp,
    recordLeafTemp,
    recordSoilMoisture,
    recordLight,
  }) => {
    const normalizedRecordLight =
      typeof recordLight === "string" ? recordLight.toUpperCase() : "";
    const recordDeltaT =
      recordAirTemp !== null && recordLeafTemp !== null
        ? roundToOneDecimal(recordLeafTemp - recordAirTemp)
        : null;

    if (recordSoilMoisture === null || !normalizedRecordLight) {
      return {
        deltaT: recordDeltaT,
        plantStatus: "--",
        recommendation: "WAITING_FOR_SENSOR_DATA",
      };
    }

    const recordHasLowSoilMoisture =
      recordSoilMoisture < LOW_SOIL_MOISTURE_THRESHOLD;
    const recordHasNightLight = normalizedRecordLight === "NIGHT";

    if (recordHasLowSoilMoisture && recordHasNightLight) {
      return {
        deltaT: recordDeltaT,
        plantStatus: "Needs Water",
        recommendation: "WATER_NOW",
      };
    }

    if (recordHasLowSoilMoisture) {
      return {
        deltaT: recordDeltaT,
        plantStatus: "Needs Water",
        recommendation: "WAIT_UNTIL_NIGHT",
      };
    }

    return {
      deltaT: recordDeltaT,
      plantStatus: "Moisture OK",
      recommendation: "NO_IRRIGATION_NEEDED",
    };
  };

  const getHistoryFormDecisionPreview = (form, useLiveSensorValues) =>
    getAutomatedHistoryDecision({
      recordAirTemp: useLiveSensorValues ? airTemp : toNumberOrNull(form?.airTemp),
      recordLeafTemp: useLiveSensorValues
        ? leafTemp
        : toNumberOrNull(form?.leafTemp),
      recordSoilMoisture: toNumberOrNull(form?.soilMoisture),
      recordLight: form?.light,
    });

  const buildHistoryRecordPayload = ({
    form,
    useLiveSensorValues,
    currentRecord,
  }) => {
    const timestamp = new Date(form.timestamp).getTime();
    const recordAirTemp = useLiveSensorValues
      ? airTemp
      : toNumberOrNull(form.airTemp);
    const recordLeafTemp = useLiveSensorValues
      ? leafTemp
      : toNumberOrNull(form.leafTemp);
    const recordHumidity = useLiveSensorValues
      ? liveHumidity
      : toNumberOrNull(form.humidity);
    const recordSoilMoisture = toNumberOrNull(form.soilMoisture);
    const recordLight = String(form.light || "").trim().toUpperCase();
    const recordPump = String(form.pump || "").trim().toUpperCase();

    if (Number.isNaN(timestamp)) {
      throw new Error("Choose a valid date and time.");
    }

    if (
      recordAirTemp === null ||
      recordLeafTemp === null ||
      recordHumidity === null
    ) {
      throw new Error(
        useLiveSensorValues
          ? "Live air temperature, leaf temperature, and humidity are needed before adding a record."
          : "Air temperature, leaf temperature, and humidity are required.",
      );
    }

    if (recordSoilMoisture === null) {
      throw new Error("Soil moisture is required.");
    }

    if (!recordLight) {
      throw new Error("Choose a light value.");
    }

    if (recordPump !== "ON" && recordPump !== "OFF") {
      throw new Error("Pump must be ON or OFF.");
    }

    const automatedDecision = getAutomatedHistoryDecision({
      recordAirTemp,
      recordLeafTemp,
      recordSoilMoisture,
      recordLight,
    });
    const recordPayload = {
      airTemp: recordAirTemp,
      deltaT: automatedDecision.deltaT,
      humidity: recordHumidity,
      leafTemp: recordLeafTemp,
      light: recordLight,
      plantStatus: automatedDecision.plantStatus,
      pump: recordPump,
      recommendation: automatedDecision.recommendation,
      soilMoisture: recordSoilMoisture,
      timestamp,
    };

    if (!currentRecord) {
      return recordPayload;
    }

    const { id: _id, ...savedRecord } = currentRecord;
    return {
      ...savedRecord,
      ...recordPayload,
    };
  };

  const handleNewHistoryFormChange = (field, value) => {
    setNewHistoryForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  };

  const handleEditHistoryFormChange = (field, value) => {
    setEditHistoryForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  };

  const handleAddHistoryRecord = async (event) => {
    event.preventDefault();
    setHistorySaveLoading(true);
    setHistoryFormStatus(null);

    try {
      const payload = buildHistoryRecordPayload({
        form: newHistoryForm,
        useLiveSensorValues: true,
      });
      const newHistoryRef = push(ref(db, "device1/history"));

      await set(newHistoryRef, payload);
      setNewHistoryForm({
        timestamp: getDateTimeInputValue(),
        soilMoisture: "",
        light: payload.light,
        pump: payload.pump,
      });
      setHistoryFormStatus({
        type: "success",
        message: "History record added to Firebase.",
      });
    } catch (error) {
      setHistoryFormStatus({
        type: "error",
        message: error.message || "Failed to add history record.",
      });
      console.error("Failed to add history record:", error);
    } finally {
      setHistorySaveLoading(false);
    }
  };

  const handleStartEditHistoryRecord = (record) => {
    setEditingRecordId(record.id);
    setEditHistoryForm({
      timestamp: getDateTimeInputValue(record.timestamp),
      airTemp: record.airTemp ?? "",
      leafTemp: record.leafTemp ?? "",
      humidity: record.humidity ?? "",
      soilMoisture: record.soilMoisture ?? "",
      light: record.light || "BRIGHT",
      pump: String(record.pump ?? record.pumpStatus ?? "OFF").toUpperCase(),
    });
    setHistoryFormStatus(null);
  };

  const handleCancelEditHistoryRecord = () => {
    setEditingRecordId(null);
    setEditHistoryForm(null);
    setHistoryFormStatus(null);
  };

  const handleSaveHistoryRecord = async (event, record) => {
    event.preventDefault();
    setHistorySaveLoading(true);
    setHistoryFormStatus(null);

    try {
      const payload = buildHistoryRecordPayload({
        form: editHistoryForm,
        useLiveSensorValues: false,
        currentRecord: record,
      });

      await set(ref(db, `device1/history/${record.id}`), payload);
      setEditingRecordId(null);
      setEditHistoryForm(null);
      setHistoryFormStatus({
        type: "success",
        message: "History record updated in Firebase.",
      });
    } catch (error) {
      setHistoryFormStatus({
        type: "error",
        message: error.message || "Failed to update history record.",
      });
      console.error("Failed to update history record:", error);
    } finally {
      setHistorySaveLoading(false);
    }
  };

  const deleteHistoryRecords = async (recordIds, successMessage) => {
    if (recordIds.length === 0) {
      return;
    }

    setHistoryDeleteLoading(true);
    setHistoryFormStatus(null);

    try {
      const updates = recordIds.reduce((nextUpdates, recordId) => {
        nextUpdates[`device1/history/${recordId}`] = null;
        return nextUpdates;
      }, {});

      await update(ref(db), updates);
      setSelectedHistoryRecordIds((currentIds) =>
        currentIds.filter((recordId) => !recordIds.includes(recordId)),
      );

      if (recordIds.includes(editingRecordId)) {
        setEditingRecordId(null);
        setEditHistoryForm(null);
      }

      setHistoryFormStatus({
        type: "success",
        message: successMessage,
      });
    } catch (error) {
      setHistoryFormStatus({
        type: "error",
        message: error.message || "Failed to delete history record.",
      });
      console.error("Failed to delete history record:", error);
    } finally {
      setHistoryDeleteLoading(false);
    }
  };

  const handleDeleteHistoryRecord = async (record) => {
    const shouldDelete = window.confirm(
      "Delete this history record from Firebase?",
    );

    if (!shouldDelete) {
      return;
    }

    await deleteHistoryRecords([record.id], "History record deleted from Firebase.");
  };

  const handleToggleHistoryRecordSelection = (recordId) => {
    setSelectedHistoryRecordIds((currentIds) =>
      currentIds.includes(recordId)
        ? currentIds.filter((currentId) => currentId !== recordId)
        : [...currentIds, recordId],
    );
  };

  useEffect(() => {
    const syncDecisionAndAutoPump = async () => {
      if (!hasDecisionInputs) {
        return;
      }

      try {
        await set(ref(db, "device1/decision"), {
          deltaT:
            calculatedDeltaT !== null ? Number(calculatedDeltaT.toFixed(1)) : null,
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

  const lightOptions = Array.from(
    new Set(
      [
        ...DEFAULT_LIGHT_OPTIONS,
        sensorData?.light,
        newHistoryForm.light,
        editHistoryForm?.light,
        ...historyRecords.map((record) => record.light),
      ]
        .filter(Boolean)
        .map((value) => String(value).toUpperCase()),
    ),
  );
  const newHistoryDecisionPreview = getHistoryFormDecisionPreview(
    newHistoryForm,
    true,
  );
  const editHistoryDecisionPreview = editHistoryForm
    ? getHistoryFormDecisionPreview(editHistoryForm, false)
    : null;

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

  const getDateFilterBoundary = (dateValue, isEndOfDay = false) => {
    if (!dateValue) {
      return null;
    }

    const date = new Date(`${dateValue}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    if (isEndOfDay) {
      date.setHours(23, 59, 59, 999);
    }

    return date;
  };

  const historyFilterStart = getDateFilterBoundary(historyFilterStartDate);
  const historyFilterEnd = getDateFilterBoundary(historyFilterEndDate, true);
  const hasHistoryDateFilter = Boolean(historyFilterStart || historyFilterEnd);
  const filteredHistoryRecords = historyRecords.filter((record) => {
    const recordDate = getRecordDate(record.timestamp);

    if ((historyFilterStart || historyFilterEnd) && !recordDate) {
      return false;
    }

    if (historyFilterStart && recordDate < historyFilterStart) {
      return false;
    }

    if (historyFilterEnd && recordDate > historyFilterEnd) {
      return false;
    }

    return true;
  });
  const filteredHistoryRecordIds = filteredHistoryRecords.map((record) => record.id);
  const filteredHistoryRecordKey = filteredHistoryRecordIds.join("|");
  const filteredHistoryRecordIdSet = new Set(filteredHistoryRecordIds);
  const selectedFilteredHistoryRecordIds = selectedHistoryRecordIds.filter(
    (recordId) => filteredHistoryRecordIdSet.has(recordId),
  );
  const isEveryFilteredHistoryRecordSelected =
    filteredHistoryRecordIds.length > 0 &&
    selectedFilteredHistoryRecordIds.length === filteredHistoryRecordIds.length;
  const displayedHistoryRecords = filteredHistoryRecords;

  useEffect(() => {
    const visibleRecordIds = new Set(
      filteredHistoryRecordKey ? filteredHistoryRecordKey.split("|") : [],
    );

    setSelectedHistoryRecordIds((currentIds) =>
      currentIds.filter((recordId) => visibleRecordIds.has(recordId)),
    );
  }, [filteredHistoryRecordKey]);

  const handleToggleAllFilteredHistoryRecords = () => {
    setSelectedHistoryRecordIds((currentIds) => {
      if (isEveryFilteredHistoryRecordSelected) {
        return currentIds.filter(
          (recordId) => !filteredHistoryRecordIdSet.has(recordId),
        );
      }

      return Array.from(new Set([...currentIds, ...filteredHistoryRecordIds]));
    });
  };

  const handleDeleteSelectedHistoryRecords = async () => {
    if (selectedFilteredHistoryRecordIds.length === 0) {
      return;
    }

    const shouldDelete = window.confirm(
      `Delete ${selectedFilteredHistoryRecordIds.length} selected history record${
        selectedFilteredHistoryRecordIds.length === 1 ? "" : "s"
      } from Firebase?`,
    );

    if (!shouldDelete) {
      return;
    }

    await deleteHistoryRecords(
      selectedFilteredHistoryRecordIds,
      `${selectedFilteredHistoryRecordIds.length} selected history record${
        selectedFilteredHistoryRecordIds.length === 1 ? "" : "s"
      } deleted from Firebase.`,
    );
  };

  const handleDeleteFilteredHistoryRecords = async () => {
    if (filteredHistoryRecordIds.length === 0) {
      return;
    }

    const shouldDelete = window.confirm(
      `Delete all ${filteredHistoryRecordIds.length} ${
        hasHistoryDateFilter ? "filtered" : "visible"
      } history record${filteredHistoryRecordIds.length === 1 ? "" : "s"} from Firebase?`,
    );

    if (!shouldDelete) {
      return;
    }

    await deleteHistoryRecords(
      filteredHistoryRecordIds,
      `${filteredHistoryRecordIds.length} history record${
        filteredHistoryRecordIds.length === 1 ? "" : "s"
      } deleted from Firebase.`,
    );
  };

  const handleClearHistoryFilters = () => {
    setHistoryFilterStartDate("");
    setHistoryFilterEndDate("");
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
    const soilThresholdY =
      selectedGraphType === "soilMoisture" &&
      lowerBound <= LOW_SOIL_MOISTURE_THRESHOLD &&
      upperBound >= LOW_SOIL_MOISTURE_THRESHOLD
        ? getY(LOW_SOIL_MOISTURE_THRESHOLD)
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
                  x={padding.left + 12}
                  y={deltaThresholdY - 8}
                >
                  Stress line
                </text>
              </g>
            ) : null}

            {soilThresholdY !== null ? (
              <g>
                <line
                  className="chart-threshold-line"
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={soilThresholdY}
                  y2={soilThresholdY}
                />
                <text
                  className="chart-threshold-label"
                  x={padding.left + 12}
                  y={soilThresholdY - 8}
                >
                  Moisture line
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
                Current recommendation is based on soil moisture and night time.
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
                {hasDecisionInputs
                  ? isLowSoilMoisture
                    ? isNightLight
                      ? `Soil moisture is below ${LOW_SOIL_MOISTURE_THRESHOLD}% and it is night.`
                      : `Soil moisture is below ${LOW_SOIL_MOISTURE_THRESHOLD}%, waiting for night.`
                    : `Soil moisture is at least ${LOW_SOIL_MOISTURE_THRESHOLD}%.`
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
            <div className="history-header-actions">
              <button
                className="secondary-button history-tools-toggle"
                type="button"
                onClick={() =>
                  setShowHistoryManagementFeatures((currentValue) => !currentValue)
                }
              >
                {showHistoryManagementFeatures ? "Hide Tools" : "Show Tools"}
              </button>
              <span className="status-pill">
                {historyRecords.length} total{" "}
                {historyRecords.length === 1 ? "record" : "records"}
              </span>
            </div>
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
            <div className="history-records-panel">
              {showHistoryManagementFeatures ? (
                <form className="history-form info-panel" onSubmit={handleAddHistoryRecord}>
                  <div className="history-record-heading">
                    <div>
                      <p className="panel-label">Add History Record</p>
                      <p className="panel-subvalue">
                        Air temperature, leaf temperature, and humidity use the live
                        sensor values.
                      </p>
                    </div>
                    <span className="status-pill">New data</span>
                  </div>

                  <div className="history-form-grid">
                    <div className="field-group">
                      <label className="field-label" htmlFor="new-history-timestamp">
                        Date and time
                      </label>
                      <input
                        className="field-input"
                        id="new-history-timestamp"
                        type="datetime-local"
                        value={newHistoryForm.timestamp}
                        onChange={(event) =>
                          handleNewHistoryFormChange("timestamp", event.target.value)
                        }
                        required
                      />
                    </div>

                    <div className="field-group">
                      <label className="field-label" htmlFor="new-history-soil">
                        Soil moisture
                      </label>
                      <input
                        className="field-input"
                        id="new-history-soil"
                        min="0"
                        max="100"
                        step="0.1"
                        type="number"
                        value={newHistoryForm.soilMoisture}
                        onChange={(event) =>
                          handleNewHistoryFormChange(
                            "soilMoisture",
                            event.target.value,
                          )
                        }
                        required
                      />
                    </div>

                  <div className="field-group">
                    <label className="field-label" htmlFor="new-history-light">
                      Light
                    </label>
                    <select
                      className="field-input"
                      id="new-history-light"
                      value={newHistoryForm.light}
                      onChange={(event) =>
                        handleNewHistoryFormChange("light", event.target.value)
                      }
                      required
                    >
                      {lightOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field-group">
                    <label className="field-label" htmlFor="new-history-pump">
                      Pump
                    </label>
                    <select
                      className="field-input"
                      id="new-history-pump"
                      value={newHistoryForm.pump}
                      onChange={(event) =>
                        handleNewHistoryFormChange("pump", event.target.value)
                      }
                      required
                    >
                      <option value="OFF">OFF</option>
                      <option value="ON">ON</option>
                    </select>
                  </div>

                  <div className="locked-field">
                    <p className="panel-label">Live Air Temp</p>
                    <p className="panel-value">
                      {airTemp !== null ? `${airTemp} °C` : "--"}
                    </p>
                  </div>

                  <div className="locked-field">
                    <p className="panel-label">Live Leaf Temp</p>
                    <p className="panel-value">
                      {leafTemp !== null ? `${leafTemp} °C` : "--"}
                    </p>
                  </div>

                  <div className="locked-field">
                    <p className="panel-label">Live Humidity</p>
                    <p className="panel-value">
                      {liveHumidity !== null ? `${liveHumidity} %` : "--"}
                    </p>
                  </div>

                  <div className="locked-field locked-field-accent">
                    <p className="panel-label">Auto Recommendation</p>
                    <p className="panel-value">
                      {formatRecommendation(newHistoryDecisionPreview.recommendation)}
                    </p>
                    <p className="panel-subvalue">
                      Delta T:{" "}
                      {newHistoryDecisionPreview.deltaT !== null
                        ? `${newHistoryDecisionPreview.deltaT.toFixed(1)} °C`
                        : "--"}
                    </p>
                  </div>
                </div>

                {historyFormStatus ? (
                  <p className={`form-message form-message-${historyFormStatus.type}`}>
                    {historyFormStatus.message}
                  </p>
                ) : null}

                <div className="actions-row">
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={historySaveLoading}
                  >
                    {historySaveLoading ? "Saving..." : "Add to History"}
                  </button>
                </div>
                </form>
              ) : null}

              <div className="history-toolbar info-panel">
                <div className="history-filter-grid">
                  <div className="field-group">
                    <label className="field-label" htmlFor="history-filter-start">
                      From date
                    </label>
                    <input
                      className="field-input"
                      id="history-filter-start"
                      type="date"
                      value={historyFilterStartDate}
                      onChange={(event) =>
                        setHistoryFilterStartDate(event.target.value)
                      }
                    />
                  </div>

                  <div className="field-group">
                    <label className="field-label" htmlFor="history-filter-end">
                      To date
                    </label>
                    <input
                      className="field-input"
                      id="history-filter-end"
                      type="date"
                      value={historyFilterEndDate}
                      onChange={(event) =>
                        setHistoryFilterEndDate(event.target.value)
                      }
                    />
                  </div>

                  <div className="history-toolbar-summary">
                    <p className="panel-label">Filtered Records</p>
                    <p className="panel-value">
                      {filteredHistoryRecords.length} / {historyRecords.length}
                    </p>
                    {showHistoryManagementFeatures ? (
                      <p className="panel-subvalue">
                        {selectedFilteredHistoryRecordIds.length} selected
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="history-bulk-actions">
                  {showHistoryManagementFeatures ? (
                    <label className="history-select-control">
                      <input
                        type="checkbox"
                        checked={isEveryFilteredHistoryRecordSelected}
                        onChange={handleToggleAllFilteredHistoryRecords}
                        disabled={
                          filteredHistoryRecords.length === 0 || historyDeleteLoading
                        }
                      />
                      <span>Select all filtered</span>
                    </label>
                  ) : null}

                  <div className="actions-row history-toolbar-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={handleClearHistoryFilters}
                      disabled={!hasHistoryDateFilter || historyDeleteLoading}
                    >
                      Clear Filter
                    </button>
                    {showHistoryManagementFeatures ? (
                      <>
                        <button
                          className="danger-button"
                          type="button"
                          onClick={handleDeleteSelectedHistoryRecords}
                          disabled={
                            selectedFilteredHistoryRecordIds.length === 0 ||
                            historyDeleteLoading
                          }
                        >
                          Delete Selected
                        </button>
                        <button
                          className="danger-button danger-button-strong"
                          type="button"
                          onClick={handleDeleteFilteredHistoryRecords}
                          disabled={
                            filteredHistoryRecords.length === 0 ||
                            historyDeleteLoading
                          }
                        >
                          {hasHistoryDateFilter ? "Delete Filtered" : "Delete All"}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              {historyRecords.length > 0 ? (
                displayedHistoryRecords.length > 0 ? (
                <div className="history-list">
                  {displayedHistoryRecords.map((record) => (
                    <div className="info-panel" key={record.id}>
                      {showHistoryManagementFeatures ? (
                        <div className="history-record-heading">
                          <div className="history-record-title">
                            <label className="history-select-control">
                              <input
                                type="checkbox"
                                checked={selectedHistoryRecordIds.includes(record.id)}
                                onChange={() =>
                                  handleToggleHistoryRecordSelection(record.id)
                                }
                                disabled={historyDeleteLoading}
                              />
                              <span>
                                <span className="panel-label">Timestamp</span>
                                <span className="panel-value">
                                  {formatTimestamp(record.timestamp)}
                                </span>
                              </span>
                            </label>
                          </div>

                          <div className="history-record-actions">
                            <button
                              className="secondary-button history-edit-button"
                              type="button"
                              onClick={() => handleStartEditHistoryRecord(record)}
                              disabled={historyDeleteLoading}
                            >
                              Edit
                            </button>
                            <button
                              className="danger-button history-edit-button"
                              type="button"
                              onClick={() => handleDeleteHistoryRecord(record)}
                              disabled={historyDeleteLoading}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <p className="panel-label">Timestamp</p>
                          <p className="panel-value">
                            {formatTimestamp(record.timestamp)}
                          </p>
                        </div>
                      )}

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

                      {showHistoryManagementFeatures &&
                      editingRecordId === record.id &&
                      editHistoryForm ? (
                        <form
                          className="history-form history-edit-form"
                          onSubmit={(event) => handleSaveHistoryRecord(event, record)}
                        >
                          <div className="history-form-grid">
                            <div className="field-group">
                              <label
                                className="field-label"
                                htmlFor={`edit-history-timestamp-${record.id}`}
                              >
                                Date and time
                              </label>
                              <input
                                className="field-input"
                                id={`edit-history-timestamp-${record.id}`}
                                type="datetime-local"
                                value={editHistoryForm.timestamp}
                                onChange={(event) =>
                                  handleEditHistoryFormChange(
                                    "timestamp",
                                    event.target.value,
                                  )
                                }
                                required
                              />
                            </div>

                            <div className="field-group">
                              <label
                                className="field-label"
                                htmlFor={`edit-history-air-${record.id}`}
                              >
                                Air temperature
                              </label>
                              <input
                                className="field-input"
                                id={`edit-history-air-${record.id}`}
                                step="0.1"
                                type="number"
                                value={editHistoryForm.airTemp}
                                onChange={(event) =>
                                  handleEditHistoryFormChange(
                                    "airTemp",
                                    event.target.value,
                                  )
                                }
                                required
                              />
                            </div>

                            <div className="field-group">
                              <label
                                className="field-label"
                                htmlFor={`edit-history-leaf-${record.id}`}
                              >
                                Leaf temperature
                              </label>
                              <input
                                className="field-input"
                                id={`edit-history-leaf-${record.id}`}
                                step="0.1"
                                type="number"
                                value={editHistoryForm.leafTemp}
                                onChange={(event) =>
                                  handleEditHistoryFormChange(
                                    "leafTemp",
                                    event.target.value,
                                  )
                                }
                                required
                              />
                            </div>

                            <div className="field-group">
                              <label
                                className="field-label"
                                htmlFor={`edit-history-humidity-${record.id}`}
                              >
                                Humidity
                              </label>
                              <input
                                className="field-input"
                                id={`edit-history-humidity-${record.id}`}
                                min="0"
                                max="100"
                                step="0.1"
                                type="number"
                                value={editHistoryForm.humidity}
                                onChange={(event) =>
                                  handleEditHistoryFormChange(
                                    "humidity",
                                    event.target.value,
                                  )
                                }
                                required
                              />
                            </div>

                            <div className="field-group">
                              <label
                                className="field-label"
                                htmlFor={`edit-history-soil-${record.id}`}
                              >
                                Soil moisture
                              </label>
                              <input
                                className="field-input"
                                id={`edit-history-soil-${record.id}`}
                                min="0"
                                max="100"
                                step="0.1"
                                type="number"
                                value={editHistoryForm.soilMoisture}
                                onChange={(event) =>
                                  handleEditHistoryFormChange(
                                    "soilMoisture",
                                    event.target.value,
                                  )
                                }
                                required
                              />
                            </div>

                            <div className="field-group">
                              <label
                                className="field-label"
                                htmlFor={`edit-history-light-${record.id}`}
                              >
                                Light
                              </label>
                              <select
                                className="field-input"
                                id={`edit-history-light-${record.id}`}
                                value={editHistoryForm.light}
                                onChange={(event) =>
                                  handleEditHistoryFormChange(
                                    "light",
                                    event.target.value,
                                  )
                                }
                                required
                              >
                                {lightOptions.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="field-group">
                              <label
                                className="field-label"
                                htmlFor={`edit-history-pump-${record.id}`}
                              >
                                Pump
                              </label>
                              <select
                                className="field-input"
                                id={`edit-history-pump-${record.id}`}
                                value={editHistoryForm.pump}
                                onChange={(event) =>
                                  handleEditHistoryFormChange(
                                    "pump",
                                    event.target.value,
                                  )
                                }
                                required
                              >
                                <option value="OFF">OFF</option>
                                <option value="ON">ON</option>
                              </select>
                            </div>

                            <div className="locked-field locked-field-accent">
                              <p className="panel-label">Auto Recommendation</p>
                              <p className="panel-value">
                                {formatRecommendation(
                                  editHistoryDecisionPreview?.recommendation,
                                )}
                              </p>
                              <p className="panel-subvalue">
                                Delta T:{" "}
                                {editHistoryDecisionPreview?.deltaT !== null &&
                                editHistoryDecisionPreview?.deltaT !== undefined
                                  ? `${editHistoryDecisionPreview.deltaT.toFixed(1)} °C`
                                  : "--"}
                              </p>
                            </div>
                          </div>

                          <div className="actions-row">
                            <button
                              className="primary-button"
                              type="submit"
                              disabled={historySaveLoading}
                            >
                              {historySaveLoading ? "Saving..." : "Save Changes"}
                            </button>
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={handleCancelEditHistoryRecord}
                              disabled={historySaveLoading}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  ))}
                </div>
                ) : (
                  <div className="info-panel">
                    <p className="panel-value">
                      No history records match the selected date filter.
                    </p>
                  </div>
                )
              ) : (
                <div className="info-panel">
                  <p className="panel-value">No history records available yet.</p>
                </div>
              )}
            </div>
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
