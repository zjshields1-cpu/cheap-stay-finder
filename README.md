# Cheap Stay Finder

**Created by Zachary Shields**

**Live site:** https://zjshields1-cpu.github.io/cheap-stay-finder/

## About this website

Cheap Stay Finder is an interactive travel map for budget travelers. Search any city, neighborhood or landmark and it lists the cheapest places to stay nearby (hostels, campgrounds, guest houses, motels, hotels and more), each with an estimated nightly price and a star rating where one is listed. Every stay is shown on a map next to the surrounding attractions. Click a stay to see walking distances to the sights closest to it, so you can find somewhere affordable that's also close to the things you want to see.

## Features

- Results are sorted cheapest first. You can also sort by attractions within ½ mile, by distance from the search point or by star rating.
- The "Show" control limits results to the top 5 / 10 / 20 / 50, with a "Show more" button for the next batch.
- Click a stay to draw walking distances to its 5 nearest attractions, with a ½ mile walking ring around it.
- Click an attraction to see the cheapest stays within a mile of it.

### Trip planner

- **Your trip:** enter where you're leaving from (or use your location), your dates and what you love doing: mountain biking, gravel and road riding, hiking, kayaking, skiing and snowboarding, national parks, camping.
- **Plan a trip:** for any searched place, builds a plan with:
  - a draft day-by-day itinerary built from what's nearby
  - getting there: drive time and gas cost, the nearest big airports with typical US fares, train links in Europe, and tips for car-free towns like Zermatt
  - the weather forecast, or last year's actual weather for trips more than two weeks out
  - lifts with the distance to each bottom station, ski areas and rental shops
  - MTB and cycling routes, bike rentals, hiking routes, trailheads, huts and viewpoints
  - kayak launches and boat rentals, national parks and campgrounds
  - groceries, cheap eats and restaurants, with walking distances
  - an estimated trip budget
- **Plan me a weekend trip:** national parks and ski areas within a few hours' drive, plus the cheapest short flights from your city.

## Data

- Places come from [OpenStreetMap](https://www.openstreetmap.org/copyright): [Nominatim](https://nominatim.org/) for search and the [Overpass API](https://overpass-api.de/) for stays and attractions. Map tiles are also from OpenStreetMap.
- **Prices are estimates.** They're typical nightly ranges based on the type of stay and its star class, not live prices.
- Ratings are official star classes, shown only where OpenStreetMap lists one. Each listing links to Google Maps and Booking.com for live prices and reviews.
- **Typical US airfares** come from the US DOT [Consumer Airfare Report, Table 6](https://data.transportation.gov/d/yj5y-b2ir): average one-way fares for real tickets sold, by city pair, for the last four published quarters. They're historical averages, not quotes; every flight links to Google Flights, Skyscanner and Kayak for live prices.
- Airports come from [OurAirports](https://ourairports.com/data/) (public domain), driving routes from the [OSRM](https://project-osrm.org/) demo server, and weather from [Open-Meteo](https://open-meteo.com/).
- Restaurants have no ratings: free map data doesn't include them, so each one links to its Google Maps reviews.

## Updating the airfare data

DOT publishes a new quarter about every three months. To refresh `data/`:

```bash
mkdir -p dl
curl -o dl/t6.json "https://data.transportation.gov/resource/yj5y-b2ir.json?\$where=year>=2025&\$limit=50000"
curl -o dl/t1a.json "https://data.transportation.gov/resource/tfrh-tu9e.json?\$select=citymarketid_1,citymarketid_2,city1,city2,airport_1,airport_2&\$where=year>=2023&\$limit=50000"
curl -o dl/airports.csv https://davidmegginson.github.io/ourairports-data/airports.csv
python tools/build_airfares.py dl data
```

Change the `year>=` filter so `t6.json` holds the last four quarters.

## Run locally

Serve the folder from any static web server, for example:

```bash
python -m http.server 8765
```

Then open http://localhost:8765.
