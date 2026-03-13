import { createYulaMcpServer, z } from "@yula-xyz/core";

const GEOCODING_API_BASE = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_API_BASE = "https://api.open-meteo.com/v1/forecast";

const WEATHER_CODE_LABELS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snowfall",
  73: "Moderate snowfall",
  75: "Heavy snowfall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

type GeocodingResult = {
  name: string;
  country?: string;
  country_code?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  timezone?: string;
};

type ForecastCurrent = {
  time: string;
  interval: number;
  temperature_2m: number;
  relative_humidity_2m: number;
  apparent_temperature: number;
  is_day: number;
  precipitation: number;
  rain: number;
  showers: number;
  snowfall: number;
  weather_code: number;
  cloud_cover: number;
  pressure_msl: number;
  surface_pressure: number;
  wind_speed_10m: number;
  wind_direction_10m: number;
};

type ForecastCurrentUnits = {
  temperature_2m: string;
  relative_humidity_2m: string;
  apparent_temperature: string;
  precipitation: string;
  rain: string;
  showers: string;
  snowfall: string;
  cloud_cover: string;
  pressure_msl: string;
  surface_pressure: string;
  wind_speed_10m: string;
  wind_direction_10m: string;
};

function assertObject(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function getString(
  record: Record<string, unknown>,
  key: string,
  fallback?: string,
): string {
  const value = record[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(`Expected "${key}" to be a string.`);
}

function getOptionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throw new Error(`Expected "${key}" to be a number.`);
}

function describeWeatherCode(code: number): string {
  return WEATHER_CODE_LABELS[code] ?? `Unknown weather code (${code})`;
}

async function fetchJson(url: URL) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Weather provider request failed with ${response.status}: ${response.statusText}`,
    );
  }

  return response.json();
}

async function resolveLocation(
  city: string,
  countryCode?: string,
  language = "en",
): Promise<GeocodingResult> {
  const geocodingUrl = new URL(GEOCODING_API_BASE);
  geocodingUrl.searchParams.set("name", city);
  geocodingUrl.searchParams.set("count", "1");
  geocodingUrl.searchParams.set("language", language);
  geocodingUrl.searchParams.set("format", "json");

  if (countryCode) {
    geocodingUrl.searchParams.set("countryCode", countryCode.toUpperCase());
  }

  const payload = assertObject(
    await fetchJson(geocodingUrl),
    "Geocoding API returned an invalid payload.",
  );
  const results = payload.results;

  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(
      `No location match was found for "${city}"${countryCode ? ` in ${countryCode.toUpperCase()}` : ""}.`,
    );
  }

  const firstResult = assertObject(
    results[0],
    "Geocoding API returned an invalid location item.",
  );

  return {
    name: getString(firstResult, "name"),
    country: getOptionalString(firstResult, "country"),
    country_code: getOptionalString(firstResult, "country_code"),
    admin1: getOptionalString(firstResult, "admin1"),
    latitude: getNumber(firstResult, "latitude"),
    longitude: getNumber(firstResult, "longitude"),
    elevation:
      typeof firstResult.elevation === "number"
        ? firstResult.elevation
        : undefined,
    timezone: getOptionalString(firstResult, "timezone"),
  };
}

async function fetchCurrentWeather(location: GeocodingResult) {
  const weatherUrl = new URL(WEATHER_API_BASE);
  weatherUrl.searchParams.set("latitude", String(location.latitude));
  weatherUrl.searchParams.set("longitude", String(location.longitude));
  weatherUrl.searchParams.set(
    "current",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "is_day",
      "precipitation",
      "rain",
      "showers",
      "snowfall",
      "weather_code",
      "cloud_cover",
      "pressure_msl",
      "surface_pressure",
      "wind_speed_10m",
      "wind_direction_10m",
    ].join(","),
  );
  weatherUrl.searchParams.set("timezone", "auto");
  weatherUrl.searchParams.set("forecast_days", "1");

  const payload = assertObject(
    await fetchJson(weatherUrl),
    "Forecast API returned an invalid payload.",
  );
  const current = assertObject(
    payload.current,
    "Forecast API did not return current weather data.",
  );
  const currentUnits = assertObject(
    payload.current_units,
    "Forecast API did not return current units.",
  );

  return {
    timezone: getString(payload, "timezone", location.timezone ?? "UTC"),
    timezoneAbbreviation: getOptionalString(payload, "timezone_abbreviation"),
    current: {
      time: getString(current, "time"),
      interval: getNumber(current, "interval"),
      temperature_2m: getNumber(current, "temperature_2m"),
      relative_humidity_2m: getNumber(current, "relative_humidity_2m"),
      apparent_temperature: getNumber(current, "apparent_temperature"),
      is_day: getNumber(current, "is_day"),
      precipitation: getNumber(current, "precipitation"),
      rain: getNumber(current, "rain"),
      showers: getNumber(current, "showers"),
      snowfall: getNumber(current, "snowfall"),
      weather_code: getNumber(current, "weather_code"),
      cloud_cover: getNumber(current, "cloud_cover"),
      pressure_msl: getNumber(current, "pressure_msl"),
      surface_pressure: getNumber(current, "surface_pressure"),
      wind_speed_10m: getNumber(current, "wind_speed_10m"),
      wind_direction_10m: getNumber(current, "wind_direction_10m"),
    } satisfies ForecastCurrent,
    currentUnits: {
      temperature_2m: getString(currentUnits, "temperature_2m"),
      relative_humidity_2m: getString(currentUnits, "relative_humidity_2m"),
      apparent_temperature: getString(currentUnits, "apparent_temperature"),
      precipitation: getString(currentUnits, "precipitation"),
      rain: getString(currentUnits, "rain"),
      showers: getString(currentUnits, "showers"),
      snowfall: getString(currentUnits, "snowfall"),
      cloud_cover: getString(currentUnits, "cloud_cover"),
      pressure_msl: getString(currentUnits, "pressure_msl"),
      surface_pressure: getString(currentUnits, "surface_pressure"),
      wind_speed_10m: getString(currentUnits, "wind_speed_10m"),
      wind_direction_10m: getString(currentUnits, "wind_direction_10m"),
    } satisfies ForecastCurrentUnits,
  };
}

export const weatherMcp = createYulaMcpServer({
  name: "yula-live-weather-mcp",
  version: "1.0.0",
  description:
    "Example Yula MCP server that fetches live current weather and local observation time from Open-Meteo.",
  basePath: "/mcp",
});

weatherMcp.tool(
  "current-weather",
  {
    title: "Current Weather",
    description:
      "Looks up a city using Open-Meteo geocoding, then fetches live current weather conditions and the location's local observation time.",
    inputSchema: {
      city: z
        .string()
        .min(1)
        .describe("City or town name, for example Istanbul or San Francisco"),
      countryCode: z
        .string()
        .length(2)
        .optional()
        .describe("Optional ISO country code such as TR or US"),
      language: z
        .string()
        .optional()
        .describe("Optional geocoding language, default is en"),
    },
    outputSchema: {
      provider: z.string().describe("Weather data provider"),
      query: z.string().describe("Original city query"),
      resolvedName: z.string().describe("Resolved location name"),
      admin1: z.string().nullable().describe("Resolved admin region if available"),
      country: z.string().nullable().describe("Resolved country name if available"),
      countryCode: z
        .string()
        .nullable()
        .describe("Resolved country code if available"),
      latitude: z.number().describe("Resolved latitude"),
      longitude: z.number().describe("Resolved longitude"),
      elevation: z.number().nullable().describe("Resolved elevation in meters"),
      timezone: z.string().describe("Resolved IANA timezone"),
      timezoneAbbreviation: z
        .string()
        .nullable()
        .describe("Timezone abbreviation if provided by the API"),
      observedAt: z
        .string()
        .describe("Local observation timestamp returned by the weather API"),
      fetchedAtUtc: z
        .string()
        .describe("UTC timestamp when this MCP server fetched the live weather"),
      weatherCode: z.number().describe("WMO weather code"),
      weatherSummary: z.string().describe("Human-readable weather summary"),
      isDay: z.boolean().describe("Whether the API reports daytime at the location"),
      temperatureC: z.number().describe("Current temperature in Celsius"),
      apparentTemperatureC: z
        .number()
        .describe("Feels-like temperature in Celsius"),
      relativeHumidity: z.number().describe("Relative humidity percentage"),
      windSpeedKmh: z.number().describe("Wind speed at 10m in km/h"),
      windDirectionDeg: z.number().describe("Wind direction in degrees"),
      precipitationMm: z.number().describe("Current precipitation in mm"),
      rainMm: z.number().describe("Current rain in mm"),
      showersMm: z.number().describe("Current showers in mm"),
      snowfallMm: z.number().describe("Current snowfall in mm"),
      cloudCoverPercent: z.number().describe("Current cloud cover percentage"),
      pressureMslHpa: z.number().describe("Mean sea level pressure"),
      surfacePressureHpa: z.number().describe("Surface pressure"),
      units: z.object({
        temperature: z.string(),
        humidity: z.string(),
        windSpeed: z.string(),
        windDirection: z.string(),
        precipitation: z.string(),
        pressure: z.string(),
      }),
    },
    annotations: {
      title: "Live Weather Lookup",
      readOnlyHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    examples: [
      {
        summary: "Get Istanbul's live weather",
        input: {
          city: "Istanbul",
          countryCode: "TR",
        },
      },
      {
        summary: "Get New York's live weather",
        input: {
          city: "New York",
          countryCode: "US",
        },
      },
    ],
  },
  async ({ city, countryCode, language }) => {
    const location = await resolveLocation(city, countryCode, language);
    const { current, currentUnits, timezone, timezoneAbbreviation } =
      await fetchCurrentWeather(location);
    const fetchedAtUtc = new Date().toISOString();

    return {
      provider: "Open-Meteo",
      query: city,
      resolvedName: location.name,
      admin1: location.admin1 ?? null,
      country: location.country ?? null,
      countryCode: location.country_code ?? null,
      latitude: location.latitude,
      longitude: location.longitude,
      elevation: location.elevation ?? null,
      timezone,
      timezoneAbbreviation: timezoneAbbreviation ?? null,
      observedAt: current.time,
      fetchedAtUtc,
      weatherCode: current.weather_code,
      weatherSummary: describeWeatherCode(current.weather_code),
      isDay: current.is_day === 1,
      temperatureC: current.temperature_2m,
      apparentTemperatureC: current.apparent_temperature,
      relativeHumidity: current.relative_humidity_2m,
      windSpeedKmh: current.wind_speed_10m,
      windDirectionDeg: current.wind_direction_10m,
      precipitationMm: current.precipitation,
      rainMm: current.rain,
      showersMm: current.showers,
      snowfallMm: current.snowfall,
      cloudCoverPercent: current.cloud_cover,
      pressureMslHpa: current.pressure_msl,
      surfacePressureHpa: current.surface_pressure,
      units: {
        temperature: currentUnits.temperature_2m,
        humidity: currentUnits.relative_humidity_2m,
        windSpeed: currentUnits.wind_speed_10m,
        windDirection: currentUnits.wind_direction_10m,
        precipitation: currentUnits.precipitation,
        pressure: currentUnits.pressure_msl,
      },
    };
  },
);

export default weatherMcp.worker();
