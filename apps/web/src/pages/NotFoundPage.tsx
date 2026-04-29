import { Link } from "react-router-dom";
import { Button } from "../components/ui";

export default function NotFoundPage() {
  return (
    <div className="pageLayout notFoundPage">
      <section className="notFoundHero">
        <div className="notFoundHero__content">
          <p className="notFoundHero__eyebrow">Error 404</p>
          <h1>Page not found</h1>
          <p>
            The page you are trying to open does not exist or may have been moved.
            You can safely go back to the home page or return to your previous screen.
          </p>
          <div className="notFoundHero__actions">
            <Link to="/">
              <Button variant="primary">Go home</Button>
            </Link>
            <Button variant="ghost" onClick={() => window.history.back()}>
              Go back
            </Button>
          </div>
        </div>
        <div className="notFoundHero__visual" aria-hidden="true">
          <img src="/images/404.jpg" alt="" />
        </div>
      </section>
    </div>
  );
}
