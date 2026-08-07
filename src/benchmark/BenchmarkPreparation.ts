import { AttackExecution } from "../../OpenFrontIO/src/core/execution/AttackExecution";
import { Intent } from "../../OpenFrontIO/src/core/Schemas";
import { EvalGameSession } from "../evals/EvalGameSession";

export type BenchmarkPreparationOperation =
  | {
      type: "benchmark_set_troop_ratio";
      playerName: string;
      relativeToEvaluated: number;
    }
  | { type: "benchmark_cancel_incoming" }
  | { type: "benchmark_cancel_outgoing" }
  | { type: "benchmark_set_hostile"; playerName: string }
  | { type: "benchmark_set_evaluated_capacity"; percent: number }
  | {
      type: "benchmark_replace_incoming";
      attackerName: string;
      fractionOfEvaluatedTroops: number;
    }
  | {
      type: "benchmark_replace_outgoing";
      targetName: string;
      fractionOfDefenderTroops: number;
    }
  | {
      type: "benchmark_prioritized_attacks";
      attackerNames: [string, string];
      fractionsOfEvaluatedTroops: [number, number];
    };

export function applyBenchmarkPreparation(
  session: EvalGameSession,
  values: Array<Intent | BenchmarkPreparationOperation>,
): Intent[] {
  const player = session.game.playerByClientID("LLMAGENT");
  if (!player) throw new Error("Benchmark preparation player is missing");
  const ordinary: Intent[] = [];
  for (const value of values) {
    if (value.type === "benchmark_set_troop_ratio") {
      const target = session.game
        .players()
        .find((item) => item.name() === value.playerName);
      if (!target)
        throw new Error(`Preparation player not found: ${value.playerName}`);
      target.setTroops(Math.floor(player.troops() * value.relativeToEvaluated));
    } else if (value.type === "benchmark_set_evaluated_capacity") {
      player.setTroops(
        Math.floor(
          (session.game.config().maxTroops(player) * value.percent) / 100,
        ),
      );
    } else if (value.type === "benchmark_cancel_incoming") {
      for (const attack of player.incomingAttacks())
        (attack as unknown as { delete(): void }).delete();
    } else if (value.type === "benchmark_cancel_outgoing") {
      for (const attack of player.outgoingAttacks())
        (attack as unknown as { delete(): void }).delete();
    } else if (value.type === "benchmark_set_hostile") {
      const opponent = session.game
        .players()
        .find((item) => item.name() === value.playerName);
      if (!opponent)
        throw new Error(`Preparation player not found: ${value.playerName}`);
      opponent.updateRelation(player, -100);
      player.updateRelation(opponent, -100);
    } else if (value.type === "benchmark_replace_incoming") {
      for (const attack of player.incomingAttacks())
        (attack as unknown as { delete(): void }).delete();
      const attacker = session.game
        .players()
        .find((item) => item.name() === value.attackerName);
      if (!attacker)
        throw new Error(
          `Preparation attacker not found: ${value.attackerName}`,
        );
      const troops = Math.floor(
        player.troops() * value.fractionOfEvaluatedTroops,
      );
      attacker.setTroops(Math.max(attacker.troops(), troops * 2));
      attacker.updateRelation(player, -100);
      player.updateRelation(attacker, -100);
      session.game.addExecution(
        new AttackExecution(troops, attacker, player.id(), null),
      );
    } else if (value.type === "benchmark_replace_outgoing") {
      for (const attack of player.outgoingAttacks())
        (attack as unknown as { delete(): void }).delete();
      const target = session.game
        .players()
        .find((item) => item.name() === value.targetName);
      if (!target)
        throw new Error(`Preparation target not found: ${value.targetName}`);
      const troops = Math.max(
        1,
        Math.floor(target.troops() * value.fractionOfDefenderTroops),
      );
      player.setTroops(Math.max(player.troops(), troops * 3));
      player.updateRelation(target, -100);
      target.updateRelation(player, -100);
      session.game.addExecution(
        new AttackExecution(troops, player, target.id(), null),
      );
    } else if (value.type === "benchmark_prioritized_attacks") {
      for (const [index, name] of value.attackerNames.entries()) {
        const troops = Math.max(
          1,
          Math.floor(player.troops() * value.fractionsOfEvaluatedTroops[index]),
        );
        const attacker = session.game
          .players()
          .find((item) => item.name() === name);
        if (!attacker)
          throw new Error(`Preparation attacker not found: ${name}`);
        attacker.setTroops(Math.max(attacker.troops(), troops * 2));
        const alliance = attacker.allianceWith(player);
        if (alliance) attacker.breakAlliance(alliance);
        attacker.updateRelation(player, -100);
        player.updateRelation(attacker, -100);
        session.game.addExecution(
          new AttackExecution(troops, attacker, player.id(), null),
        );
      }
    } else {
      ordinary.push(value);
    }
  }
  return ordinary;
}
