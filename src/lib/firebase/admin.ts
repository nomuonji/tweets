import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    return undefined;
  }

  try {
    const json =
      raw.trim().startsWith("{") && raw.trim().endsWith("}")
        ? raw
        : Buffer.from(raw, "base64").toString("utf-8");
    return JSON.parse(json);
  } catch {
    throw new Error("Failed to parse FIREBASE_SERVICE_ACCOUNT");
  }
}

const app =
  getApps()[0] ??
  initializeApp(
    getServiceAccount()
      ? {
          credential: cert(getServiceAccount()!),
        }
      : undefined,
  );

export const adminDb = getFirestore(app);
