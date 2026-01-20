// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Jesse Hill Climb Scoreboard
/// @notice Stores the best score (in meters) per address, but emits an event for every submission.
contract JesseHillClimbScoreboard {
  mapping(address => uint256) public bestMeters;

  event ScoreSubmitted(address indexed player, uint256 meters, uint256 newBestMeters);

  /// @notice Submit a score in meters. Always emits an event. Updates bestMeters only if higher.
  function submitScore(uint256 meters) external {
    uint256 prev = bestMeters[msg.sender];
    uint256 next = prev;
    if (meters > prev) {
      bestMeters[msg.sender] = meters;
      next = meters;
    }
    emit ScoreSubmitted(msg.sender, meters, next);
  }
}
