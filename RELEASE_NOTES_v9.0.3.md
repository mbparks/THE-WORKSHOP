# THE WORKSHOP v9.0.3 — Maker Crew Coordinate Precision

This patch standardizes Maker Crew map coordinates at full 14-decimal display precision.

Crew Studio now uses the format:

```text
39.68050852174287, -78.76667986159089
```

The latitude and longitude fields preserve this display precision, accept unrestricted decimal input, and immediately refresh the Crew map status after saving. The existing starred-ZIP centroid default and reset behavior are unchanged.
