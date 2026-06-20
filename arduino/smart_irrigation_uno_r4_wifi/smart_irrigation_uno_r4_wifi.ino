#include <WiFiS3.h>
#include <ArduinoHttpClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_MLX90614.h>
#include <Adafruit_SHT31.h>
#include <BH1750.h>
#include "arduino_secrets.h"








// -------------------- WiFi --------------------
const char WIFI_SSID[] = SECRET_WIFI_SSID;
const char WIFI_PASS[] = SECRET_WIFI_PASS;




// -------------------- Firebase Realtime Database --------------------
// Example:
// If your database URL is:
// https://smart-irrigation-default-rtdb.asia-southeast1.firebasedatabase.app
// use only:
// smart-irrigation-default-rtdb.asia-southeast1.firebasedatabase.app
const char FIREBASE_HOST[] = "smart-irrigation-system-4b76d-default-rtdb.asia-southeast1.firebasedatabase.app";




// Leave empty if your test Realtime Database rules allow public read/write.
// For secured rules, use a valid Firebase auth token or database secret:
// const char FIREBASE_AUTH[] = "YOUR_TOKEN";
const char FIREBASE_AUTH[] = SECRET_FIREBASE_AUTH;




const char DEVICE_ID[] = "device1";




// -------------------- Pins --------------------
const int SOIL_PIN = A0;
const int PUMP_PIN = 7;




// -------------------- Calibration --------------------
// Read Serial Monitor values with the probe dry and fully wet, then tune these.
// If your sensor works opposite, swap these two numbers.
const int SOIL_DRY_RAW = 132;
const int SOIL_WET_RAW = 160;




// BH1750 lux threshold. Tune for your actual plant area.
const float NIGHT_LUX_MAX = 50.0;
const float LOW_LIGHT_LUX_MAX = 500.0;
const float BRIGHT_LUX_MAX = 10000.0;




// Automation thresholds. These match the dashboard logic.
const float HIGH_DELTA_T_THRESHOLD = 3.0;
const int LOW_SOIL_MOISTURE_THRESHOLD = 40;




// Timings.
const unsigned long SENSOR_UPLOAD_INTERVAL_MS = 10000;
const unsigned long CONTROL_POLL_INTERVAL_MS = 3000;
const unsigned long HISTORY_UPLOAD_INTERVAL_MS = 60000;




WiFiSSLClient wifiClient;
HttpClient http(wifiClient, FIREBASE_HOST, 443);




Adafruit_MLX90614 mlx = Adafruit_MLX90614();
Adafruit_SHT31 sht31 = Adafruit_SHT31();
BH1750 lightMeter;




unsigned long lastSensorUpload = 0;
unsigned long lastControlPoll = 0;
unsigned long lastHistoryUpload = 0;




float airTemp = NAN;
float humidity = NAN;
float leafTemp = NAN;
float lux = NAN;
int soilRaw = 0;
int soilMoisture = 0;
String lightState = "UNKNOWN";
String mode = "MANUAL";
String pumpCommand = "OFF";
String actualPumpStatus = "OFF";
String lastSyncedPumpStatus = "";
float deltaT = NAN;
String plantStatus = "--";
String recommendation = "WAITING_FOR_SENSOR_DATA";




String firebasePath(const String& path) {
  String fullPath = "/" + path + ".json";




  if (strlen(FIREBASE_AUTH) > 0) {
    fullPath += "?auth=";
    fullPath += FIREBASE_AUTH;
  }




  return fullPath;
}




void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }




  Serial.print("Connecting to WiFi");




  while (WiFi.begin(WIFI_SSID, WIFI_PASS) != WL_CONNECTED) {
    Serial.print(".");
    delay(3000);
  }




  Serial.println();
  Serial.print("Connected. IP: ");
  Serial.println(WiFi.localIP());
}




bool requestFirebase(const char* method, const String& path, const String& body, String& response) {
  connectWiFi();




  String url = firebasePath(path);




  http.beginRequest();




  if (strcmp(method, "GET") == 0) {
    http.get(url);
  } else if (strcmp(method, "POST") == 0) {
    http.post(url);
  } else if (strcmp(method, "PUT") == 0) {
    http.put(url);
  } else {
    Serial.println("Unsupported HTTP method.");
    http.stop();
    return false;
  }




  http.sendHeader("Content-Type", "application/json");
  http.sendHeader("Connection", "close");




  if (body.length() > 0) {
    http.sendHeader("Content-Length", body.length());
    http.beginBody();
    http.print(body);
  }




  http.endRequest();




  int statusCode = http.responseStatusCode();
  response = http.responseBody();
  http.stop();




  if (statusCode < 200 || statusCode >= 300) {
    Serial.print("Firebase ");
    Serial.print(method);
    Serial.print(" failed. HTTP ");
    Serial.print(statusCode);
    Serial.print(" Response: ");
    Serial.println(response);
    return false;
  }




  return true;
}




int readSoilMoisturePercent() {
  soilRaw = analogRead(SOIL_PIN);




  int percent = map(soilRaw, SOIL_DRY_RAW, SOIL_WET_RAW, 0, 100);
  return constrain(percent, 0, 100);
}


String getLightState(float luxValue) {
  if (isnan(luxValue)) {
    return "UNKNOWN";
  }


  if (luxValue < NIGHT_LUX_MAX) {
    return "NIGHT";
  } else if (luxValue < LOW_LIGHT_LUX_MAX) {
    return "LOW_LIGHT";
  } else if (luxValue < BRIGHT_LUX_MAX) {
    return "BRIGHT";
  } else {
    return "STRONG_DAYLIGHT";
  }
}


void readSensors() {
  airTemp = sht31.readTemperature();
  humidity = sht31.readHumidity();
  leafTemp = mlx.readObjectTempC();
  lux = lightMeter.readLightLevel();
  soilMoisture = readSoilMoisturePercent();
 lightState = getLightState(lux);




  Serial.println("---- Sensor Readings ----");
  Serial.print("Air temp: ");
  Serial.println(airTemp);
  Serial.print("Humidity: ");
  Serial.println(humidity);
  Serial.print("Leaf temp: ");
  Serial.println(leafTemp);
  Serial.print("Soil raw: ");
  Serial.println(soilRaw);
  Serial.print("Soil moisture %: ");
  Serial.println(soilMoisture);
  Serial.print("Lux: ");
  Serial.println(lux);
  Serial.print("Light: ");
  Serial.println(lightState);
}




bool hasValidDecisionInputs() {
  return !isnan(airTemp) && !isnan(leafTemp) && lightState != "UNKNOWN";
}




void calculateDecision() {
  if (!hasValidDecisionInputs()) {
    deltaT = NAN;
    plantStatus = "--";
    recommendation = "WAITING_FOR_SENSOR_DATA";
    return;
  }




  deltaT = leafTemp - airTemp;




  bool isHighDeltaT = deltaT >= HIGH_DELTA_T_THRESHOLD;
  bool isLowSoilMoisture = soilMoisture < LOW_SOIL_MOISTURE_THRESHOLD;




  plantStatus = isHighDeltaT ? "Stressed" : "Healthy";




  if (isHighDeltaT && isLowSoilMoisture && lightState == "NIGHT") {
    recommendation = "WATER_NOW";
  } else if (isHighDeltaT && isLowSoilMoisture && lightState == "DAY") {
    recommendation = "WAIT_UNTIL_NIGHT";
  } else if (isHighDeltaT && !isLowSoilMoisture) {
    recommendation = "DO_NOT_IRRIGATE";
  } else if (!isHighDeltaT && isLowSoilMoisture) {
    recommendation = "MONITOR_DELAY_IRRIGATION";
  } else {
    recommendation = "NO_IRRIGATION_NEEDED";
  }




  Serial.print("Delta T: ");
  Serial.println(deltaT);
  Serial.print("Plant status: ");
  Serial.println(plantStatus);
  Serial.print("Recommendation: ");
  Serial.println(recommendation);
}




String sensorJson() {
  StaticJsonDocument<512> doc;




  doc["airTemp"] = isnan(airTemp) ? 0 : round(airTemp * 10) / 10.0;
  doc["humidity"] = isnan(humidity) ? 0 : round(humidity * 10) / 10.0;
  doc["leafTemp"] = isnan(leafTemp) ? 0 : round(leafTemp * 10) / 10.0;
  doc["soilMoisture"] = soilMoisture;
  doc["soilRaw"] = soilRaw;
  doc["lux"] = isnan(lux) ? 0 : round(lux * 10) / 10.0;
  doc["light"] = lightState;
  doc["timestamp"][".sv"] = "timestamp";




  String json;
  serializeJson(doc, json);
  return json;
}




void uploadSensorData() {
  String response;
  String path = String(DEVICE_ID) + "/sensorData";
  String body = sensorJson();




  if (requestFirebase("PUT", path, body, response)) {
    Serial.println("Uploaded sensorData.");
  }
}




void uploadDecisionData() {
  String response;
  String path = String(DEVICE_ID) + "/decision";




  StaticJsonDocument<384> doc;
  doc["deltaT"] = isnan(deltaT) ? 0 : round(deltaT * 10) / 10.0;
  doc["plantStatus"] = plantStatus;
  doc["recommendation"] = recommendation;
  doc["timestamp"][".sv"] = "timestamp";




  String body;
  serializeJson(doc, body);




  if (requestFirebase("PUT", path, body, response)) {
    Serial.println("Uploaded decision.");
  }
}




void uploadPumpCommand() {
  String response;
  String path = String(DEVICE_ID) + "/control/pump";
  String body = String("\"") + actualPumpStatus + "\"";




  if (requestFirebase("PUT", path, body, response)) {
    lastSyncedPumpStatus = actualPumpStatus;
    Serial.print("Synced pump status: ");
    Serial.println(actualPumpStatus);
  }
}




void syncPumpStatus() {
  if (actualPumpStatus == lastSyncedPumpStatus) {
    return;
  }




  uploadPumpCommand();
}




void runManualControl() {
  if (mode != "MANUAL") {
    return;
  }




  if (pumpCommand != "ON" && pumpCommand != "OFF") {
    pumpCommand = "OFF";
  }




  applyPumpCommand();
  syncPumpStatus();
}




void runAutomation() {
  if (mode != "AUTO") {
    return;
  }




  pumpCommand = recommendation == "WATER_NOW" ? "ON" : "OFF";
  applyPumpCommand();
  syncPumpStatus();
}




void uploadHistoryRecord() {
  String response;
  String path = String(DEVICE_ID) + "/history";




  StaticJsonDocument<512> doc;
  doc["airTemp"] = isnan(airTemp) ? 0 : round(airTemp * 10) / 10.0;
  doc["humidity"] = isnan(humidity) ? 0 : round(humidity * 10) / 10.0;
  doc["leafTemp"] = isnan(leafTemp) ? 0 : round(leafTemp * 10) / 10.0;
  doc["soilMoisture"] = soilMoisture;
  doc["light"] = lightState;
  doc["pump"] = actualPumpStatus;
  doc["deltaT"] = isnan(deltaT) ? 0 : round(deltaT * 10) / 10.0;
  doc["plantStatus"] = plantStatus;
  doc["recommendation"] = recommendation;
  doc["timestamp"][".sv"] = "timestamp";




  String body;
  serializeJson(doc, body);




  if (requestFirebase("POST", path, body, response)) {
    Serial.println("Uploaded history record.");
  }
}




void pollControl() {
  String response;
  String path = String(DEVICE_ID) + "/control";




  if (!requestFirebase("GET", path, "", response)) {
    return;
  }




  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, response);




  if (error) {
    Serial.print("Failed to parse control JSON: ");
    Serial.println(error.c_str());
    return;
  }




  mode = doc["mode"] | "MANUAL";
  pumpCommand = doc["pump"] | "OFF";




  Serial.print("Control mode: ");
  Serial.println(mode);
  Serial.print("Pump command: ");
  Serial.println(pumpCommand);




  if (mode == "AUTO") {
    runAutomation();
  } else {
    runManualControl();
  }
}




void applyPumpCommand() {
  if (pumpCommand == "ON") {
    digitalWrite(PUMP_PIN, HIGH);
    actualPumpStatus = "ON";
  } else {
    digitalWrite(PUMP_PIN, LOW);
    actualPumpStatus = "OFF";
  }
}




void setupSensors() {
  Wire.begin();




  if (!mlx.begin()) {
    Serial.println("MLX90614 not found. Check wiring.");
  }




  if (!sht31.begin(0x44)) {
    Serial.println("SHT31 not found at 0x44. Try 0x45 if your module uses that address.");
  }




  if (!lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
    Serial.println("BH1750 not found. Check wiring.");
  }
}




void ensureDefaultControlExists() {
  String response;
  String path = String(DEVICE_ID) + "/control";




  if (requestFirebase("GET", path, "", response) && response != "null") {
    return;
  }




  String body = "{\"mode\":\"MANUAL\",\"pump\":\"OFF\"}";
  requestFirebase("PUT", path, body, response);
}




void setup() {
  Serial.begin(115200);
  delay(1500);




  pinMode(PUMP_PIN, OUTPUT);
  digitalWrite(PUMP_PIN, LOW);




  analogReadResolution(12);




  setupSensors();
  connectWiFi();
  ensureDefaultControlExists();
  pollControl();




  Serial.println("Smart irrigation controller started.");
}




void loop() {
  unsigned long now = millis();




  if (now - lastSensorUpload >= SENSOR_UPLOAD_INTERVAL_MS) {
    lastSensorUpload = now;
    readSensors();
    calculateDecision();
    uploadSensorData();
    uploadDecisionData();
    runAutomation();
  }




  if (now - lastControlPoll >= CONTROL_POLL_INTERVAL_MS) {
    lastControlPoll = now;
    pollControl();
  }




  if (now - lastHistoryUpload >= HISTORY_UPLOAD_INTERVAL_MS) {
    lastHistoryUpload = now;
    uploadHistoryRecord();
  }
}

