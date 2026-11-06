import { api, type Course, type User } from "../api";
import { formatLabel, STATE_LABELS } from "../format";
import { Alert } from "../ui/feedback";
import { Empty } from "../ui/icons";
import { Link, PageHeading } from "../ui/router";
import { useLoad } from "../ui/useLoad";

export function Courses({ user }: { user: User }) {
  const { data, failure } = useLoad(() => api<{ courses: Course[] }>("GET", "/api/courses"));
  const courses = data?.courses ?? null;
  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Accredited continuing education</p>
        <PageHeading>Courses</PageHeading>
        <p className="lede">
          {user.role === "learner"
            ? "Choose a course, finish every lesson and the post-evaluation, and earn one sealed contact-hour certificate."
            : "The catalogue of courses from Sorrel & Pike Learning, with their contact hours and list prices."}
        </p>
      </div>
      {failure && <Alert>{failure}</Alert>}
      <div className="catalogue-head" aria-hidden="true">
        <span>Course</span>
        <span>Format</span>
        <span className="fig">Minutes</span>
        <span className="fig">Contact hours</span>
        <span className="fig">List price</span>
      </div>
      <ul className="ruled" aria-label="Course catalogue">
        {courses === null &&
          [0, 1, 2].map((n) => (
            <li key={n} aria-hidden="true">
              <span className="skeleton" style={{ width: "40%" }} />
            </li>
          ))}
        {courses?.map((course) => (
          <li key={course.id} className="catalogue-row">
            <div className="title">
              <Link to={`/courses/${course.id}`}>{course.title}</Link>
              {course.state !== "published" && (
                <>
                  {" "}
                  <span className="badge">{STATE_LABELS[course.state]}</span>
                </>
              )}
              <p className="summary">{course.summary}</p>
            </div>
            <span>{formatLabel(course.format)}</span>
            <span className="fig">{course.total_minutes} min</span>
            <span className="fig">{course.contact_hours} h</span>
            <span className="fig">${course.list_price}</span>
          </li>
        ))}
      </ul>
      {courses?.length === 0 && <Empty>No courses are published yet.</Empty>}
    </>
  );
}
