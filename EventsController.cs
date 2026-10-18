using EventRegistrationAPI.Data;
using EventRegistrationAPI.Models;
using Microsoft.AspNetCore.Mvc;

namespace EventRegistrationAPI.Controllers;

[ApiController]
[Route("api/[controller]")]
public class EventsController : ControllerBase 

{
    private readonly DataStore _db;

    // ASP.NET gives us the DataStore that Program.cs created
    public EventsController(DataStore db)
    {
        _db = db;
    }

     {
        int registered = _db.Registrations.Count(r => r.EventId == e.Id);
        return new
        {
            e.Id, e.Title, e.Date, e.Time, e.Venue, e.Capacity, e.Description,
            registered,
            seatsLeft = e.Capacity - registered,
            isPast = e.Date < DataStore.Today
        };

     } 

     [HttpGet]
    public IActionResult GetAll()
    {
        lock (_db)
        {
            var events = _db.Events
                .OrderBy(e => e.Date).ThenBy(e => e.Time)
                .Select(e => WithCounts(e))
                .ToList();
            return Ok(events);
        }
    } 

    [HttpGet("{id:int}")]
    public IActionResult GetById(int id)
    {
        lock (_db)
        {
            var ev = _db.Events.FirstOrDefault(e => e.Id == id);
            if (ev == null) return NotFound(new { error = "Event not found" });
            return Ok(WithCounts(ev));
        }
    } 

      [HttpPost]
    public IActionResult Create(CreateEventRequest req)
    {
        string title = DataStore.Clean(req.Title, 80);
        string venue = DataStore.Clean(req.Venue, 80);

        if (title.Length < 3) return BadRequest(new { error = "Please enter an event title" });
        if (venue.Length < 2) return BadRequest(new { error = "Please enter the venue" });
        if (req.Date < DataStore.Today) return BadRequest(new { error = "The event date cannot be in the past" });
        if (req.Capacity < 1 || req.Capacity > 1000) return BadRequest(new { error = "Maximum participants must be from 1 to 1000" });

        lock (_db) 


        {
            var ev = new SchoolEvent
            {
                Id = _db.Events.Select(e => e.Id).DefaultIfEmpty(0).Max() + 1,
                Title = title,
                Date = req.Date,
                Time = req.Time,
                Venue = venue,
                Capacity = req.Capacity,
                Description = DataStore.Clean(req.Description, 500)
            };
            _db.Events.Add(ev);
            _db.Save();   // writes everything to data.json
            return CreatedAtAction(nameof(GetById), new { id = ev.Id }, WithCounts(ev));
        }
    } 

     [HttpGet("{id:int}/participants")]
    public IActionResult GetParticipants(int id)
    {
        lock (_db)
        {
            var ev = _db.Events.FirstOrDefault(e => e.Id == id);
            if (ev == null) return NotFound(new { error = "Event not found" });

            // join = match each Registration with its Student by StudentId
            var participants = (
                from r in _db.Registrations.Where(r => r.EventId == id).OrderBy(r => r.RegisteredAt)
                join s in _db.Students on r.StudentId equals s.StudentId
                select new { s.StudentId, s.FullName, s.GradeSection, s.Email, r.RegisteredAt, r.Code }
            ).ToList();

            return Ok(new { @event = WithCounts(ev), participants });   // @event because "event" is a C# keyword
        }
    }
}