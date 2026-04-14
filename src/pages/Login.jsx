import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { auth } from "../firebase";

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const getFirebaseErrorMessage = (code) => {
    switch (code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
        return "Wrong password. Please try again.";
      case "auth/user-not-found":
        return "User not found. Please check your email.";
      default:
        return "Login failed. Please try again.";
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/dashboard");
    } catch (firebaseError) {
      setError(getFirebaseErrorMessage(firebaseError.code));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      navigate("/dashboard");
    } catch (firebaseError) {
      setError(getFirebaseErrorMessage(firebaseError.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="auth-card">
        <span className="brand-tag">Smart Irrigation Dashboard</span>
        <h1 className="page-title">Welcome back</h1>
        <p className="page-subtitle">
          Sign in to view your irrigation system dashboard and sensor activity.
        </p>

        <form className="auth-form" onSubmit={handleLogin}>
          <div className="field-group">
            <label className="field-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="field-input"
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className="field-input"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>

        <p className="divider-text">or</p>

        <button
          className="secondary-button"
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
        >
          {loading ? "Please wait..." : "Login with Google"}
        </button>

        <p className="auth-footer">
          Don&apos;t have an account?{" "}
          <Link className="auth-link" to="/register">
            Register here
          </Link>
        </p>
      </div>
    </div>
  );
}

export default Login;
