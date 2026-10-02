export {};

declare global {
  // Shape of the `metadata` claim added to Clerk session tokens
  // (instance config: session.claims.metadata = {{user.public_metadata}}).
  // lib/auth.ts falls back to the user's public metadata when the claim is absent.
  interface CustomJwtSessionClaims {
    metadata?: {
      role?: "rep" | "manager" | "admin";
    };
  }

  interface UserPublicMetadata {
    role?: "rep" | "manager" | "admin";
  }
}
