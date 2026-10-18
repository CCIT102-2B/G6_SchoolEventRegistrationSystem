using EventRegistrationAPI.Data;
using EventRegistrationAPI.Models;
using Microsoft.AspNetCore.Mvc;

namespace EventRegistrationAPI.Controllers; 

[ApiController]
[Route("api/[controller]")]
public class RegistrationsController : ControllerBase 

{
    private readonly DataStore _db;

    public RegistrationsController(DataStore db)
    {
        _db = db;
    }
 

 [HttpPost]
    public IActionResult Register(RegisterRequest req)
    {
        string studentId = DataStore.Clean(req.StudentId, 20).ToUpper();
        string fullName = DataStore.Clean(req.FullName, 60);
        string gradeSection = DataStore.Clean(req.GradeSection, 30);
        string email = DataStore.Clean(req.Email, 80).ToLower();

        if (studentId == "" || fullName.Length < 2 || gradeSection == "")
            return BadRequest(new { error = "Please fill in all the student information" });
        if (!DataStore.IsEmail(email))
            return BadRequest(new { error = "Please enter a valid email address" });

        lock (_db)

         {
            var ev = _db.Events.FirstOrDefault(e => e.Id == req.EventId);
            if (ev == null) return NotFound(new { error = "Event not found" });
            if (ev.Date < DataStore.Today) return Conflict(new { error = "This event has already passed" });

            int taken = _db.Registrations.Count(r => r.EventId == ev.Id);
            if (taken >= ev.Capacity) return Conflict(new { error = "Sorry, this event is already full" });

            if (_db.Registrations.Any(r => r.EventId == ev.Id && r.StudentId == studentId))
                return Conflict(new { error = $"Student {studentId} is already registered for this event" });

var student = _db.Students.FirstOrDefault(s => s.StudentId == studentId);
            if (student == null)

            {
                student = new Student { StudentId = studentId };
                _db.Students.Add(student);
            }

             student.FullName = fullName;
            student.GradeSection = gradeSection;
            student.Email = email;

            var reg = new Registration

            {
                Id = _db.Registrations.Select(r => r.Id).DefaultIfEmpty(0).Max() + 1,
                Code = DataStore.RandomCode(),
                EventId = ev.Id,
                StudentId = studentId,
                RegisteredAt = DateTime.Now
            };

            _db.Registrations.Add(reg);
            _db.Save();

            return CreatedAtAction(nameof(GetByCode), new { code = reg.Code }, Confirmation(reg, student, ev));
        }
    }

 [HttpGet("{code}")]
    public IActionResult GetByCode(string code)
    {
        lock (_db)
        {
            var reg = _db.Registrations.FirstOrDefault(r => r.Code == code.ToUpper());
            if (reg == null) return NotFound(new { error = "No registration found for that code" });

            var student = _db.Students.First(s => s.StudentId == reg.StudentId);
            var ev = _db.Events.First(e => e.Id == reg.EventId);
            return Ok(Confirmation(reg, student, ev));
        }
    }
}
