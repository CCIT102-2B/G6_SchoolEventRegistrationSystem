using EventRegistrationAPI.Data;
using Microsoft.AspNetCore.Mvc;

namespace EventRegistrationAPI.Controllers;

[ApiController]
[Route("api/[controller]")]
public class StudentsController : ControllerBase

{
    private readonly DataStore _db;

    public StudentsController(DataStore db)
    {
        _db = db;
    }

[HttpGet("{studentId}")]
    public IActionResult GetByStudentId(string studentId)
    {
        string id = DataStore.Clean(studentId, 20).ToUpper();

        lock (_db) 

        {
            var student = _db.Students.FirstOrDefault(s => s.StudentId == id);
            if (student == null) return NotFound(new { error = "Student not found" });

            var registrations = (
                from r in _db.Registrations.Where(r => r.StudentId == id)
                join e in _db.Events on r.EventId equals e.Id
                select new { r.Code, eventTitle = e.Title, e.Date, e.Time, e.Venue, r.RegisteredAt }
            ).ToList();

            return Ok(new { student.StudentId, student.FullName, student.GradeSection, student.Email, registrations });
        }
    }
}