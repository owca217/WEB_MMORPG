import type { GoogleAuthChallenge } from "./AuthApi";
import { Capacitor, registerPlugin } from "@capacitor/core";
import "./GoogleSignIn.css";

interface NativeGoogleSignIn {
  signIn(options: { clientId: string; nonce: string }): Promise<{ idToken: string }>;
  signOut(): Promise<void>;
}

interface GoogleCredentialResponse { credential?: string; state?: string }
interface GoogleIdentity {
  initialize(config: {
    client_id: string; nonce: string; auto_select: boolean; button_auto_select: boolean;
    ux_mode: "popup"; callback: (response: GoogleCredentialResponse) => void;
  }): void;
  renderButton(host: HTMLElement, config: {
    type: "standard"; theme: "outline"; size: "large"; text: "signin_with";
    locale: "pl"; state: string;
  }): void;
  disableAutoSelect(): void;
}

const nativeGoogle = registerPlugin<NativeGoogleSignIn>("GoogleSignIn");
const SCRIPT_URL = "https://accounts.google.com/gsi/client";
let identityLoading: Promise<GoogleIdentity> | undefined;

function currentIdentity(): GoogleIdentity | undefined {
  return (globalThis as typeof globalThis & { google?: { accounts?: { id?: GoogleIdentity } } }).google?.accounts?.id;
}

export class GoogleSignInError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "GoogleSignInError"; }
}

export function isGoogleCancelled(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "GOOGLE_CANCELLED";
}

function normalizedError(error: unknown): GoogleSignInError {
  if (isGoogleCancelled(error)) return new GoogleSignInError("GOOGLE_CANCELLED", "");
  return new GoogleSignInError("GOOGLE_UNAVAILABLE", "Logowanie Google jest teraz niedostępne. Spróbuj ponownie lub użyj loginu i hasła.");
}

function loadIdentity(): Promise<GoogleIdentity> {
  const existing = currentIdentity();
  if (existing) return Promise.resolve(existing);
  if (identityLoading) return identityLoading;
  identityLoading = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => failed(), 15_000);
    const failed = (): void => {
      clearTimeout(timer); script.remove();
      reject(normalizedError(undefined));
    };
    script.src = SCRIPT_URL; script.async = true; script.defer = true;
    script.onload = () => {
      const identity = currentIdentity();
      if (!identity) { failed(); return; }
      clearTimeout(timer); resolve(identity);
    };
    script.onerror = failed;
    document.head.append(script);
  }).catch(error => { identityLoading = undefined; throw error; });
  return identityLoading;
}

export interface GoogleSignInCallbacks {
  signal: AbortSignal;
  onCredential: (idToken: string) => void;
  onError: (error: unknown) => void;
}

export interface GoogleSignInAdapter {
  mount(host: HTMLElement, challenge: GoogleAuthChallenge, callbacks: GoogleSignInCallbacks): Promise<void>;
}

export class GoogleSignIn implements GoogleSignInAdapter {
  async mount(host: HTMLElement, challenge: GoogleAuthChallenge, callbacks: GoogleSignInCallbacks): Promise<void> {
    const { signal, onCredential, onError } = callbacks;
    if (signal.aborted) return;
    signal.addEventListener("abort", () => host.replaceChildren(), { once: true });
    if (Capacitor.isNativePlatform()) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "google-sign-in__native";
      button.textContent = "Zaloguj się przez Google";
      let pending = false;
      button.addEventListener("click", () => {
        if (signal.aborted || pending) return;
        pending = true; button.disabled = true;
        void nativeGoogle.signIn({ clientId: challenge.clientId, nonce: challenge.nonce }).then(result => {
          if (signal.aborted) return;
          if (!result.idToken) throw new GoogleSignInError("GOOGLE_INVALID_RESPONSE", "Google nie zwróciło potwierdzenia logowania.");
          onCredential(result.idToken);
        }).catch(error => { if (!signal.aborted) onError(normalizedError(error)); }).finally(() => {
          pending = false; button.disabled = false;
        });
      });
      host.replaceChildren(button);
      return;
    }

    const identity = await loadIdentity();
    if (signal.aborted) return;
    let received = false;
    // GIS keeps the most recent configuration globally. Button state prevents
    // an older popup from completing a newer login/link challenge.
    identity.initialize({
      client_id: challenge.clientId, nonce: challenge.nonce, auto_select: false,
      button_auto_select: false, ux_mode: "popup",
      callback: response => {
        if (signal.aborted || received || response.state !== challenge.nonce) return;
        if (!response.credential) { onError(normalizedError(undefined)); return; }
        received = true; onCredential(response.credential);
      }
    });
    identity.renderButton(host, {
      type: "standard", theme: "outline", size: "large", text: "signin_with", locale: "pl", state: challenge.nonce
    });
  }

  async signOut(): Promise<void> {
    try {
      if (Capacitor.isNativePlatform()) await nativeGoogle.signOut();
      else currentIdentity()?.disableAutoSelect();
    } catch {
      // Provider cleanup must never prevent local game logout.
    }
  }
}

export const googleSignIn = new GoogleSignIn();
