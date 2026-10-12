/** A problem the user can act on; its message is shown in the app as is. */
export class UserError extends Error {}

/** The current job was stopped by the user. */
export class Cancelled extends Error {}
