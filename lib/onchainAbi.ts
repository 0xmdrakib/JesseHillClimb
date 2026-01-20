import type { Abi } from "viem";

export const scoreboardAbi = [
  {
    type: "function",
    name: "bestMeters",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "submitScore",
    stateMutability: "nonpayable",
    inputs: [{ name: "meters", type: "uint256" }],
    outputs: [],
  },
] as const satisfies Abi;

export const runNftAbi = [
  {
    type: "function",
    name: "nextTokenId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "mintRun",
    stateMutability: "nonpayable",
    inputs: [
      { name: "meters", type: "uint256" },
      { name: "driverId", type: "uint8" },
      { name: "tokenURI", type: "string" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
] as const satisfies Abi;
