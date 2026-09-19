# Line

Line is an iPhone-first progressive web app for tracking weight without overreacting to daily scale noise. It works offline, stores data only on the device, supports goals and unit conversion, and creates a transparent short-term forecast from recent measurements.

![No account](https://img.shields.io/badge/account-none-70dfea)
![Dependencies](https://img.shields.io/badge/runtime_dependencies-0-7b72ff)
![License](https://img.shields.io/badge/license-MIT-f5f7fa)

## What it includes

- Daily weigh-ins with edit and delete
- Seven-day moving average and responsive canvas chart
- Four-week, twelve-week, one-year, and all-time views
- Goal progress, target dates, and trend-based forecast
- Pounds and kilograms
- System, dark, and light appearance
- Local-only browser storage
- JSON backup/import and CSV export
- Offline service worker and iPhone home-screen metadata
- Accessible touch targets, reduced-motion support, and keyboard-friendly dialogs
- Optional WebMCP tools for logging a weight, setting a goal, and reading the current summary

## Run locally

Serve the `dist` directory over HTTP. Service workers do not run when the files are opened directly from Finder.

```bash
python3 -m http.server 8080 --directory dist
```

Then open `http://localhost:8080`.

## Publish with GitHub Pages

1. Create an empty GitHub repository.
2. Upload this project, or push it with Git.
3. In **Settings → Pages**, choose **GitHub Actions** as the source.
4. Push to `main`. The included workflow publishes the `dist` folder.
5. Open the published URL in Safari on iPhone, tap **Share**, then **Add to Home Screen**.

The app uses only relative URLs, so it works from either a user site or a project subpath.

## Forecast method

Line calculates the current display weight from entries within the most recent seven calendar days. It estimates pace using ordinary least-squares linear regression across up to 42 recent days. A goal date appears only when the observed trend points toward the goal and the implied arrival falls within two years.

The confidence label is intentionally qualitative. It considers number of measurements, observation span, and goodness of fit. The prediction assumes the recent linear trend continues; it is not a physiological model or medical advice.

General pacing language links directly to official guidance from the [CDC](https://www.cdc.gov/healthy-weight-growth/losing-weight/index.html) and [NHLBI](https://www.nhlbi.nih.gov/health/heart-healthy-living/healthy-weight).

## Data format

Weights are stored internally in kilograms so switching display units does not degrade precision. The JSON export is the complete portable backup. CSV export follows the unit selected at export time.

## Structure

```text
dist/
  index.html
  styles.css
  app.js
  manifest.webmanifest
  sw.js
  icons/
.github/workflows/pages.yml
```

No build step or third-party runtime dependency is required.

## License

MIT
