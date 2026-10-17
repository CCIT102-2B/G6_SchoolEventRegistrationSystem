# SchoolEvents (offline version): Event Registration System

Works with NO server and NO Node.js. Just open `index.html` in your browser.

## Run it
Double-click `index.html`. That is all.

## How it works
- `index.html`: the page structure (4 tabs: Events, Register, Participants, Add event)
- `style.css`: the look
- `app.js`: everything else. The "API layer" (6 commented functions) checks the input and saves the data. The screens call those functions and show the result.

Data is saved in your browser's **localStorage**, so it is still there after a refresh or after closing the browser. Use the **Reset to sample data** button at the bottom of the page to start over.

## The APIs (explained as comments inside app.js)
| # | Function | What it does |
|---|---|---|
| 1 | API.getEvents() | List all events with seats left |
| 2 | API.getEvent(id) | Get one event |
| 3 | API.addEvent(details) | Add a new event |
| 4 | API.registerStudent(eventId, student) | Register a student, returns a confirmation code |
| 5 | API.getParticipants(eventId) | List the students registered for an event |
| 6 | API.resetData() | Delete everything and restore the sample events |

## Things to know
- Data lives in ONE browser on ONE computer. Another browser, another computer, or a phone will not see it.
- Clearing browsing data (cookies and site data) erases it, and private/incognito windows do not keep it.
- If you need many students to register from their own devices, use the server version instead.
