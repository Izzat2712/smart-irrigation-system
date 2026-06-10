export function getFirebaseAuthErrorMessage(error) {
  switch (error?.code) {
    case "auth/email-already-in-use":
      return "This email is already registered. Try logging in instead.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "The email or password is incorrect.";
    case "auth/weak-password":
      return "Use a password with at least 6 characters.";
    case "auth/user-not-found":
      return "No account exists for this email. Register first.";
    case "auth/operation-not-allowed":
      return "This sign-in method is not enabled in Firebase. Enable Email/Password or Google in Firebase Authentication.";
    case "auth/unauthorized-domain":
      return "Firebase is blocking this domain. Add localhost to Firebase Authentication authorized domains.";
    case "auth/popup-blocked":
      return "The Google sign-in popup was blocked. Allow popups and try again.";
    case "auth/popup-closed-by-user":
      return "Google sign-in was closed before it finished.";
    case "auth/network-request-failed":
      return "Firebase could not be reached. Check your internet connection and try again.";
    default:
      if (error?.code?.includes("requests-from-referer")) {
        return "Firebase is blocking requests from localhost. Add http://localhost:5173/* to the API key's HTTP referrer restrictions in Google Cloud, or remove that restriction while developing locally.";
      }

      return error?.message || "Authentication failed. Please try again.";
  }
}
