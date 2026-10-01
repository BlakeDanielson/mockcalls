export {};

declare global {
  // Shape of the `metadata` claim added to Clerk session tokens
  // (instance config: session.claims.metadata = {{user.public_metadata}}).
  interface CustomJwtSessionClaims {
    metadata?: {
      role?: "manager";
    };
  }
}
