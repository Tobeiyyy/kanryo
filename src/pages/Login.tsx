import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) navigate("/");
    else setError(true);
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <h1>Kanryo</h1>
        <input
          className="input" type="password" placeholder="Password" autoFocus
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error-text">Wrong password.</p>}
        <button className="btn btn-primary" type="submit">Sign in</button>
      </form>
    </div>
  );
}
