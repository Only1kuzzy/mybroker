// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TimeLockedVault {
    struct Plan {
        uint256 lockDays;
        uint16 rewardBps;
        string name;
    }

    struct Deposit {
        uint256 amount;
        uint256 unlockAt;
        uint8 planId;
        bool withdrawn;
    }

    mapping(uint8 => Plan) public plans;
    mapping(address => Deposit[]) private userDeposits;

    event Deposited(address indexed user, uint8 indexed planId, uint256 amount, uint256 unlockAt, uint256 index);
    event Withdrawn(address indexed user, uint256 indexed index, uint256 payout);

    constructor() {
        plans[1] = Plan({ lockDays: 30, rewardBps: 500, name: "Flex" });
        plans[2] = Plan({ lockDays: 90, rewardBps: 1000, name: "Growth" });
        plans[3] = Plan({ lockDays: 180, rewardBps: 1800, name: "Diamond" });
    }

    receive() external payable {}

    function deposit(uint8 planId) external payable {
        require(msg.value > 0, "Send ETH to deposit");
        Plan memory plan = plans[planId];
        require(plan.lockDays > 0, "Invalid plan");

        uint256 unlockAt = block.timestamp + plan.lockDays * 1 days;
        userDeposits[msg.sender].push(Deposit(msg.value, unlockAt, planId, false));

        emit Deposited(msg.sender, planId, msg.value, unlockAt, userDeposits[msg.sender].length - 1);
    }

    function withdraw(uint256 index) external {
        require(index < userDeposits[msg.sender].length, "Invalid deposit index");

        Deposit storage dep = userDeposits[msg.sender][index];
        require(!dep.withdrawn, "Already withdrawn");
        require(block.timestamp >= dep.unlockAt, "Deposit still locked");

        dep.withdrawn = true;
        uint256 reward = calculateReward(dep.amount, dep.planId);
        uint256 payout = dep.amount + reward;

        require(address(this).balance >= payout, "Insufficient contract balance");
        (bool sent, ) = msg.sender.call{ value: payout }("");
        require(sent, "Transfer failed");

        emit Withdrawn(msg.sender, index, payout);
    }

    function getDepositCount(address account) external view returns (uint256) {
        return userDeposits[account].length;
    }

    function getDeposit(address account, uint256 index)
        external
        view
        returns (
            uint256 amount,
            uint256 unlockAt,
            uint8 planId,
            bool withdrawn,
            uint256 payout
        )
    {
        require(index < userDeposits[account].length, "Invalid deposit index");
        Deposit storage dep = userDeposits[account][index];
        amount = dep.amount;
        unlockAt = dep.unlockAt;
        planId = dep.planId;
        withdrawn = dep.withdrawn;
        payout = dep.amount + calculateReward(dep.amount, dep.planId);
    }

    function calculateReward(uint256 amount, uint8 planId) public view returns (uint256) {
        Plan memory plan = plans[planId];
        return (amount * plan.rewardBps) / 10000;
    }

    function planDetails(uint8 planId) external view returns (uint256 lockDays, uint16 rewardBps, string memory name) {
        Plan memory plan = plans[planId];
        require(plan.lockDays > 0, "Invalid plan");
        return (plan.lockDays, plan.rewardBps, plan.name);
    }
}
