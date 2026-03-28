# Assignment Parsing Feature Guide

## What's New

The OpenAI parser now handles **two types of content**:

1. **Schedules** — Classes, sections, time slots, room numbers
2. **Assignments** — Due dates, descriptions, which course they belong to

---

## How to Use

### Option 1: Snap a Photo of Your Syllabus or Assignment Sheet

1. Go to **Schedule** page
2. Click **"Photo of schedule"** tab
3. Click camera icon or upload image
4. App uses GPT-4o vision to extract:
   - All classes and their meeting times
   - Any assignments mentioned with due dates
5. Review and confirm before saving

**Best for:**
- Syllabus pages with schedule + assignments
- Assignment sheets with class info
- Printed schedules with handwritten notes

### Option 2: Type or Paste Assignment Info

1. Go to **Schedule** page
2. Click **"Type or paste"** tab
3. Paste your assignment info (comma-separated, list, etc.)
4. Submit

**Example input:**
```
Algebra I - Period 1 - 8:00am Room 204
  - Chapter 3 Quiz due March 31
  - Homework assignment due April 2
  - Project due April 15

Chemistry - Period 3 - 10:30am Room 102
  - Lab report due April 5
```

**Example output:**
```json
{
  "schedule": [
    {
      "name": "Algebra I",
      "period": "Period 1",
      "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      "time": "08:00",
      "room": "204",
      "subject": "Math",
      "grade": "9",
      "type": "class"
    },
    {
      "name": "Chapter 3 Quiz",
      "course_name": "Algebra I",
      "due_date": "2026-03-31",
      "description": "Sections 3.1-3.4, 20 questions",
      "type": "assignment"
    },
    {
      "name": "Homework assignment",
      "course_name": "Algebra I",
      "due_date": "2026-04-02",
      "description": null,
      "type": "assignment"
    }
  ]
}
```

---

## Response Format

### Schedule Item (Class)
```json
{
  "type": "class",
  "name": "Algebra I",
  "period": "Period 1",
  "days": ["Monday", "Wednesday", "Friday"],
  "time": "08:00",
  "room": "204",
  "subject": "Math",
  "grade": "9"
}
```

### Assignment Item
```json
{
  "type": "assignment",
  "name": "Chapter 3 Quiz",
  "course_name": "Algebra I",
  "due_date": "2026-03-31",
  "description": "Sections 3.1-3.4, 20 questions"
}
```

---

## What Gets Parsed

### Classes/Sections
✅ Course name (e.g., "Algebra I", "AP Biology")
✅ Period/block (e.g., "Period 1", "Block A")
✅ Meeting days (Monday-Friday, A-Day, B-Day)
✅ Meeting time in 24-hour format (08:00, 13:30)
✅ Room number
✅ Subject (inferred: Math, Science, English, etc.)
✅ Grade level (inferred: 9, 10, AP, Honors, etc.)

### Assignments
✅ Assignment name/title
✅ Which course it belongs to
✅ Due date (parsed to YYYY-MM-DD format)
✅ Description (if provided)

---

## What Gets Skipped

The parser intentionally skips:
- Lunch, Prep, Planning periods
- Staff meetings
- Professional development
- Break times
- Generic "Free time" blocks
- Non-instructional items

---

## Future Steps

Once assignments are parsed, they can be:
1. **Saved to a new "Assignments" table** in Supabase (future feature)
2. **Displayed on a calendar view** (future feature)
3. **Set reminders** for due dates (future feature)
4. **Linked to lesson progress tracking** (future feature)

For now, assignments are parsed and shown in the review modal, but not yet stored in the database.

---

## Tips for Best Results

### Photo Tips
- Use good lighting
- Capture full page in frame
- Use landscape mode if possible
- Avoid shadows and glare
- Higher resolution = better parsing

### Text Tips
- Include course names clearly
- Use consistent formatting
- Include room numbers when available
- Include day/time if available
- Use clear due date format (March 31, 3/31, 2026-03-31)

### What Confuses the Parser
- Unclear abbreviations (e.g., "Alg" for Algebra)
- Mixed 12/24 hour time formats
- Unclear day references (e.g., "next Wednesday")
- Very small text in images
- Handwriting (works but less reliable)

---

## Troubleshooting

**"No classes found"**
- Check that course names are clear
- Include meeting times if possible
- Verify day names are recognizable (Monday-Friday, A-Day, B-Day)

**"Due date not parsed"**
- Use standard date formats: "March 31", "3/31", "2026-03-31"
- Avoid relative dates like "next week" or "in 3 days"
- Must include month and day (year is optional)

**"Assignment not linked to course"**
- Mention the course name near the assignment
- Use consistent course name spelling
- Avoid abbreviations

---

## API Details (for developers)

**Endpoint:** `POST /api/parse-schedule`

**Request:**
```json
{
  "text": "Algebra I Period 1 8:00am...",
  "image": "base64string"
}
```

**Response:**
```json
{
  "schedule": [
    { "type": "class", ... },
    { "type": "assignment", ... }
  ]
}
```

---

## Cost Impact

- **Text parsing:** Uses GPT-4o-mini (~$0.00015 per request)
- **Image parsing:** Uses GPT-4o vision (~$0.005 per image)

Parsing 100 syllabi ≈ $0.50 total cost.
