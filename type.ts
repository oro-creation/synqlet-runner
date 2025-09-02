export type Log = {
  loggedAt: string;
  text: string;
  from: "Stdout" | "Stderr";
};
