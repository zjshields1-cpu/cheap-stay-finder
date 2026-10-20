# Cheap Stay Finder

Search any place and see the cheapest places to stay nearby (hostels, campgrounds, guest houses, motels, hotels and more) on a map, alongside the attractions around them.

- Results are sorted cheapest first. You can also sort by attractions within ½ mile, by distance from the search point or by star rating.
- The "Show" control limits results to the top 5 / 10 / 20 / 50, with a "Show more" button for the next batch.
- Click a stay to draw walking distances to its 5 nearest attractions, with a ½ mile walking ring around it.
- Click an attraction to see the cheapest stays within a mile of it.

## Data

- Places come from [OpenStreetMap](https://www.openstreetmap.org/copyright): [Nominatim](https://nominatim.org/) for search and the [Overpass API](https://overpass-api.de/) for stays and attractions. Map tiles are also from OpenStreetMap.
- **Prices are estimates.** They're typical nightly ranges based on the type of stay and its star class, not live prices.
- Ratings are official star classes, shown only where OpenStreetMap lists one. Each listing links to Google Maps and Booking.com for live prices and reviews.

## Run locally

Serve the folder from any static web server, for example:

```bash
python -m http.server 8765
```

Then open http://localhost:8765.
