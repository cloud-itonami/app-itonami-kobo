import { describe, it, beforeEach } from "node:test";
import { expect } from "./expect.mjs";
import { LocalStore } from "../dist/local-store.js";
import { spawnAgent, budAgent, sporulate, ferment, getAgent, BUD_SCAR_LIMIT } from "../dist/domain/index.js";

describe("kobo agent lifecycle", () => {
  let e: any;
  beforeEach(async () => { e = new LocalStore({ did: "did:web:kobo.itonami.cloud" }); await spawnAgent(e, { agentId: "root", name: "Root" }); });

  it("spawns generation 0 and refuses duplicates", async () => {
    expect((await getAgent(e, { agentId: "root" })).agent.generation).toBe(0);
    expect((await spawnAgent(e, { agentId: "root", name: "x" })).status).toBe("alreadyExists");
    expect((await spawnAgent(e, { agentId: "", name: "x" })).error).toBe("missingRequiredFields");
  });

  it("buds children one generation deeper and ages the parent", async () => {
    const r = await budAgent(e, { parentId: "root", childId: "c1" });
    expect(r.generation).toBe(1);
    expect((await budAgent(e, { parentId: "c1", childId: "g1" })).generation).toBe(2);
    expect((await budAgent(e, { parentId: "root", childId: "c1" })).error).toBe("childIdExists");
    expect((await budAgent(e, { parentId: "nope", childId: "x" })).error).toBe("parentNotFound");
    for (let i = 2; i <= BUD_SCAR_LIMIT; i++) await budAgent(e, { parentId: "root", childId: `c${i}` });
    const root = await getAgent(e, { agentId: "root" });
    expect(root.agent.state).toBe("senescent");
    expect(root.budsLeft).toBe(0);
    expect((await budAgent(e, { parentId: "root", childId: "late" })).error).toBe("parentIsSenescent");
  });

  it("sporulates active agents only and keeps spores from fermenting or budding", async () => {
    expect((await sporulate(e, { agentId: "root" })).status).toBe("sporulated");
    expect((await sporulate(e, { agentId: "root" })).status).toBe("alreadySpore");
    expect((await ferment(e, { fermentId: "f1", agentId: "root", substrate: "glucose", amount: 10 })).error).toBe("sporesAreDormant");
    expect((await budAgent(e, { parentId: "root", childId: "x" })).error).toBe("parentIsSpore");
  });

  it("ferments substrate into product and accumulates it", async () => {
    expect((await ferment(e, { fermentId: "f1", agentId: "root", substrate: "glucose", amount: 10 })).product).toBe(5.1);
    const second = await ferment(e, { fermentId: "f2", agentId: "root", substrate: "glucose", amount: 2 });
    expect(second.totalProduced).toBe(6.12);
    expect((await ferment(e, { fermentId: "f2", agentId: "root", substrate: "glucose", amount: 2 })).status).toBe("alreadyExists");
    expect((await ferment(e, { fermentId: "f3", agentId: "root", substrate: "glucose", amount: -1 })).error).toBe("amountMustBePositive");
    expect((await getAgent(e, { agentId: "root" })).agent.fermented).toBe(12);
  });
});
