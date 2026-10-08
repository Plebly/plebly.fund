import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, WORKERS_API: "https://api.test/" };
});

import {
  fetchOpsRoles,
  nominateOpsRole,
  opsActionLabel,
  opsRoleLabel,
  voteOpsRoleBallot,
} from "./ops-roles";

const ballot = {
  id: "b1",
  kind: "comms",
  action: "grant" as const,
  nominee_user_id: "u2",
  initiator_user_id: "u1",
  rationale: "r",
  created_at: "2026-10-01T00:00:00Z",
  closes_at: "2026-10-08T00:00:00Z",
  status: "open",
  vote_count: 0,
  counts: { yes: 0, no: 0 },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
// What Cloudflare / a proxy returns on an outage: an HTML page, not JSON.
const html = (status: number) =>
  new Response("<!DOCTYPE html><html><body>Bad gateway</body></html>", {
    status,
    headers: { "content-type": "text/html" },
  });

const nominate = () =>
  nominateOpsRole({
    kind: "comms",
    action: "grant",
    nominee_user_id: "u2",
    rationale: "r",
  });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("ops-roles POST helpers: non-JSON error bodies", () => {
  it("nominate: HTML 502 reports the status, not a JSON SyntaxError", async () => {
    fetchMock.mockResolvedValue(html(502));
    await expect(nominate()).rejects.toThrow("Nominate failed (502)");
  });

  it("nominate: HTML 401 still maps to login_required", async () => {
    fetchMock.mockResolvedValue(html(401));
    await expect(nominate()).rejects.toThrow("login_required");
  });

  it("vote: HTML 503 reports the status, not a JSON SyntaxError", async () => {
    fetchMock.mockResolvedValue(html(503));
    await expect(voteOpsRoleBallot("b1", "yes")).rejects.toThrow(
      "Ops role vote failed (503)",
    );
  });

  it("vote: HTML 401 still maps to login_required", async () => {
    fetchMock.mockResolvedValue(html(401));
    await expect(voteOpsRoleBallot("b1", "no")).rejects.toThrow("login_required");
  });
});

describe("ops-roles POST helpers: JSON responses", () => {
  it("nominate posts the input with the session bearer and returns the ballot", async () => {
    sessionStorage.setItem("plebly_session", "tok");
    fetchMock.mockResolvedValue(json(200, { ballot }));
    await expect(nominate()).resolves.toEqual(ballot);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/ops/roles/nominate");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(JSON.parse(init.body)).toEqual({
      kind: "comms",
      action: "grant",
      nominee_user_id: "u2",
      rationale: "r",
    });
  });

  it("nominate surfaces the worker's error string", async () => {
    fetchMock.mockResolvedValue(json(409, { error: "ballot_already_open" }));
    await expect(nominate()).rejects.toThrow("ballot_already_open");
  });

  it("vote encodes the ballot id and sends no bearer when signed out", async () => {
    fetchMock.mockResolvedValue(json(200, { ballot }));
    await voteOpsRoleBallot("a/b c", "yes");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/ops/roles/ballots/a%2Fb%20c/vote");
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(init.body)).toEqual({ vote: "yes" });
  });

  it("vote: 200 without a ballot is an error", async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await expect(voteOpsRoleBallot("b1", "yes")).rejects.toThrow(
      "Ops role vote failed (200)",
    );
  });

  it("nominate: 200 without a ballot is an error", async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await expect(nominate()).rejects.toThrow("Nominate failed (200)");
  });

  it("nominate: an HTML 200 is an error, never a ballot", async () => {
    fetchMock.mockResolvedValue(html(200));
    await expect(nominate()).rejects.toThrow("Nominate failed (200)");
  });

  it("vote: an HTML 200 is an error, never a ballot", async () => {
    fetchMock.mockResolvedValue(html(200));
    await expect(voteOpsRoleBallot("b1", "yes")).rejects.toThrow(
      "Ops role vote failed (200)",
    );
  });
});

describe("fetchOpsRoles", () => {
  it("normalizes an old worker's { roles, count } payload", async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await expect(fetchOpsRoles()).resolves.toEqual({
      roles: [],
      count: 0,
      kinds: undefined,
      gate: undefined,
      ballots: undefined,
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/ops/roles");
  });

  it("drops non-array lists and keeps valid fields", async () => {
    const gate = {
      open: true,
      completions: 3,
      min_completions: 3,
      reviewers: 5,
      min_reviewers: 5,
      reason: "",
    };
    fetchMock.mockResolvedValue(
      json(200, { roles: {}, count: "2", kinds: ["comms"], gate, ballots: [ballot] }),
    );
    await expect(fetchOpsRoles()).resolves.toEqual({
      roles: [],
      count: 0,
      kinds: ["comms"],
      gate,
      ballots: [ballot],
    });
  });

  it("returns null on a non-OK response", async () => {
    fetchMock.mockResolvedValue(json(500, { error: "x" }));
    await expect(fetchOpsRoles()).resolves.toBeNull();
  });
});

describe("labels", () => {
  it("names known role kinds and passes unknown ones through", () => {
    expect(opsRoleLabel("triage_steward")).toBe("Triage steward");
    expect(opsRoleLabel("incident_scribe")).toBe("Incident scribe");
    expect(opsRoleLabel("comms")).toBe("Comms");
    expect(opsRoleLabel("bootstrap")).toBe("Bootstrap ops");
    expect(opsRoleLabel("new_kind")).toBe("new_kind");
  });

  it("names ballot actions and passes unknown ones through", () => {
    expect(opsActionLabel("grant")).toBe("Grant");
    expect(opsActionLabel("remove")).toBe("Remove");
    expect(opsActionLabel("retain")).toBe("Retain");
    expect(opsActionLabel("other")).toBe("other");
  });
});
