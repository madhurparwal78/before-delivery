import { useEffect, useState, type ReactNode } from 'react';
import { request } from '../lib/api.js';
import { Link } from '../lib/router.js';
import { COURSE_STATE_LABELS } from '../lib/format.js';
import type { Course } from '../lib/types.js';

const FORMAT_LABELS: Record<string, string> = { self_paced: 'Self-paced', cohort: 'Live cohort' };

export function Courses(): ReactNode {
  const [courses, setCourses] = useState<Course[]>([]);

  useEffect(() => {
    void request<{ courses: Course[] }>('/api/courses').then(
      (result) => setCourses(result.courses),
      () => setCourses([]),
    );
  }, []);

  return (
    <>
      <h1>Courses</h1>
      <ul className="rows" aria-label="Course catalogue">
        {courses.map((course) => (
          <li key={course.id} className="row">
            <span className="row__main">
              <Link to={`/courses/${course.id}`} className="row__title">
                {course.title}
              </Link>
              <div className="hint">
                {FORMAT_LABELS[course.format] ?? course.format}
                {course.state === 'published' ? '' : ` · ${COURSE_STATE_LABELS[course.state] ?? course.state}`}
              </div>
            </span>
            <span className="row__figures">
              <span>
                <span className="total-label">Minutes</span>
                <br />
                {course.total_minutes}
              </span>
              <span>
                <span className="total-label">Contact hours</span>
                <br />
                {course.contact_hours}
              </span>
              <span>
                <span className="total-label">List price</span>
                <br />${course.list_price}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
