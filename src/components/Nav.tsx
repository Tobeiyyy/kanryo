import { NavLink } from "react-router-dom";
import { useInbox } from "../api";

export default function Nav() {
  const inbox = useInbox();
  const count = inbox.data?.length ?? 0;
  return (
    <nav className="nav">
      <NavLink to="/" className="nav-brand">Kanryo</NavLink>
      <div className="nav-links">
        <NavLink to="/" end>Projects</NavLink>
        <NavLink to="/inbox">
          Inbox{count > 0 && <span className="nav-badge">{count}</span>}
        </NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </div>
    </nav>
  );
}
