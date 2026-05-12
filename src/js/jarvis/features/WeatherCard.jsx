import { weatherCodeToDescription, weatherCodeToEmoji } from "../lib/weatherCodes.js";
import { useJarvis } from "../context/JarvisProvider.jsx";

export function WeatherCard({ prepend, reorderDropTargetProps = {} }) {
  const { state } = useJarvis();
  const data = state.weatherData;
  if (state.weatherFailed) {
    return (
      <div className="card" id="weatherCard" {...reorderDropTargetProps}>
        {prepend}
        <h3>Weather</h3>
        <div id="weatherContent">
          <span className="no-items">Could not load weather</span>
        </div>
      </div>
    );
  }
  if (!data || !data.current || !data.daily) {
    return (
      <div className="card" id="weatherCard" {...reorderDropTargetProps}>
        {prepend}
        <h3>Weather</h3>
        <div id="weatherContent">
          <span className="no-items">Loading weather...</span>
        </div>
      </div>
    );
  }
  const c = data.current;
  const d = data.daily;
  return (
    <div className="card" id="weatherCard" {...reorderDropTargetProps}>
      {prepend}
      <h3>Weather</h3>
      <div id="weatherContent">
        <div className="weather-now">
          <div style={{ fontSize: "2.2rem" }}>{weatherCodeToEmoji(c.weather_code)}</div>
          <div>
            <div className="weather-temp">{Math.round(c.temperature_2m)}°F</div>
            <div className="weather-desc">{weatherCodeToDescription(c.weather_code)}</div>
          </div>
        </div>
        <div className="weather-details">
          Feels like {Math.round(c.apparent_temperature)}°F &bull; Humidity {c.relative_humidity_2m}% &bull; Wind{" "}
          {Math.round(c.wind_speed_10m)} mph
          <br />
          Hi {Math.round(d.temperature_2m_max[0])}° / Lo {Math.round(d.temperature_2m_min[0])}°
        </div>
      </div>
    </div>
  );
}
