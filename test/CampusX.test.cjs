const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CampusX", function () {
  let campusX;
  let admin;
  let reporter;
  let resolver;
  let voter;
  let other;
  const details = {
    title: "Laboratory workstation offline",
    description: "The workstation in Lab 2 has not powered on since Monday.",
    category: 0,
    location: "Technology building, Lab 2",
    severity: 2,
  };

  async function create() {
    const tx = await campusX
      .connect(reporter)
      .createIssue(
        details.title,
        details.description,
        details.category,
        details.location,
        details.severity,
      );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return campusX.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "IssueCreated");
    return { tx, receipt, issueId: event.args.issueId };
  }

  async function prepareAwaitingVerification() {
    const { issueId } = await create();
    await campusX.connect(admin).setResolver(resolver.address, true);
    await campusX.connect(admin).assignIssue(issueId, resolver.address);
    await campusX.connect(resolver).setIssueInProgress(issueId);
    await campusX
      .connect(resolver)
      .submitRepair(issueId, "Replaced the power cable and tested the workstation.", ethers.id("evidence.png"));
    return issueId;
  }

  beforeEach(async function () {
    [admin, reporter, resolver, voter, other] = await ethers.getSigners();
    const CampusX = await ethers.getContractFactory("CampusX", admin);
    campusX = await CampusX.deploy();
    await campusX.waitForDeployment();
  });

  it("creates an issue with a unique ID, routed team, and event", async function () {
    const first = await create();
    const second = await create();
    expect(first.issueId).to.equal(1n);
    expect(second.issueId).to.equal(2n);
    expect(await campusX.issueCount()).to.equal(2n);
    await expect(first.tx)
      .to.emit(campusX, "IssueCreated")
      .withArgs(1n, reporter.address, 0n, 2n, "IT & Laboratory Equipment");
    const issue = await campusX.getIssue(1);
    expect(issue.status).to.equal(0n);
    expect(issue.reporter).to.equal(reporter.address);
    expect(issue.assignedResolver).to.equal(ethers.ZeroAddress);
  });

  it("rejects invalid issue fields and categories", async function () {
    await expect(
      campusX.connect(reporter).createIssue("No", details.description, 0, details.location, 1),
    ).to.be.revertedWithCustomError(campusX, "InvalidTitle");
    await expect(
      campusX.connect(reporter).createIssue(details.title, "Too short", 0, details.location, 1),
    ).to.be.revertedWithCustomError(campusX, "InvalidDescription");
    await expect(
      campusX.connect(reporter).createIssue(details.title, details.description, 6, details.location, 1),
    ).to.be.revertedWithCustomError(campusX, "InvalidCategory");
    await expect(
      campusX.connect(reporter).createIssue(details.title, details.description, 0, "A", 1),
    ).to.be.revertedWithCustomError(campusX, "InvalidLocation");
    await expect(
      campusX.connect(reporter).createIssue(details.title, details.description, 0, details.location, 4),
    ).to.be.revertedWithCustomError(campusX, "InvalidSeverity");
  });

  it("assigns only authorized resolvers and rejects non-admin assignment", async function () {
    const { issueId } = await create();
    await expect(campusX.connect(other).assignIssue(issueId, resolver.address)).to.be.revertedWithCustomError(
      campusX,
      "Unauthorized",
    );
    await expect(campusX.connect(admin).assignIssue(issueId, resolver.address)).to.be.revertedWithCustomError(
      campusX,
      "ResolverNotAuthorized",
    );
    await campusX.connect(admin).setResolver(resolver.address, true);
    await expect(campusX.connect(admin).assignIssue(issueId, resolver.address))
      .to.emit(campusX, "IssueAssigned")
      .withArgs(issueId, resolver.address, "IT & Laboratory Equipment");
    expect((await campusX.getIssue(issueId)).status).to.equal(1n);
  });

  it("allows only the assigned authorized resolver to start work", async function () {
    const { issueId } = await create();
    await campusX.connect(admin).setResolver(resolver.address, true);
    await campusX.connect(admin).assignIssue(issueId, resolver.address);
    await expect(campusX.connect(other).setIssueInProgress(issueId)).to.be.revertedWithCustomError(
      campusX,
      "NotAssignedResolver",
    );
    await expect(campusX.connect(resolver).setIssueInProgress(issueId))
      .to.emit(campusX, "IssueStatusChanged")
      .withArgs(issueId, 1n, 2n, resolver.address);
    expect((await campusX.getIssue(issueId)).status).to.equal(2n);
  });

  it("rejects invalid status transitions", async function () {
    const { issueId } = await create();
    await expect(campusX.connect(admin).assignIssue(issueId, other.address)).to.be.revertedWithCustomError(
      campusX,
      "ResolverNotAuthorized",
    );
    await expect(campusX.connect(reporter).confirmResolution(issueId)).to.be.revertedWithCustomError(
      campusX,
      "InvalidStatusTransition",
    );
  });

  it("records one vote per wallet and updates the on-chain count", async function () {
    const { issueId } = await create();
    await expect(campusX.connect(voter).voteForIssue(issueId))
      .to.emit(campusX, "VoteRecorded")
      .withArgs(issueId, voter.address, 1n);
    await campusX.connect(other).voteForIssue(issueId);
    expect((await campusX.getIssue(issueId)).voteCount).to.equal(2n);
    expect(await campusX.hasVoted(issueId, voter.address)).to.equal(true);
    await expect(campusX.connect(voter).voteForIssue(issueId)).to.be.revertedWithCustomError(
      campusX,
      "AlreadyVoted",
    );
  });

  it("rejects voting on unknown or resolved issues", async function () {
    await expect(campusX.connect(voter).voteForIssue(1)).to.be.revertedWithCustomError(
      campusX,
      "InvalidIssueId",
    );
    const issueId = await prepareAwaitingVerification();
    await campusX.connect(reporter).confirmResolution(issueId);
    await expect(campusX.connect(voter).voteForIssue(issueId)).to.be.revertedWithCustomError(
      campusX,
      "InvalidStatusTransition",
    );
  });

  it("requires an assigned resolver, in-progress status, description, and evidence hash", async function () {
    const { issueId } = await create();
    await campusX.connect(admin).setResolver(resolver.address, true);
    await campusX.connect(admin).assignIssue(issueId, resolver.address);
    await expect(
      campusX.connect(other).submitRepair(issueId, "A repair has been carried out.", ethers.id("file")),
    ).to.be.revertedWithCustomError(campusX, "NotAssignedResolver");
    await expect(
      campusX.connect(resolver).submitRepair(issueId, "A repair has been carried out.", ethers.id("file")),
    ).to.be.revertedWithCustomError(campusX, "InvalidStatusTransition");
    await campusX.connect(resolver).setIssueInProgress(issueId);
    await expect(
      campusX.connect(resolver).submitRepair(issueId, "Short", ethers.id("file")),
    ).to.be.revertedWithCustomError(campusX, "InvalidRepairDescription");
    await expect(
      campusX.connect(resolver).submitRepair(issueId, "A repair has been carried out.", ethers.ZeroHash),
    ).to.be.revertedWithCustomError(campusX, "EvidenceHashRequired");
    const repairTx = await campusX
      .connect(resolver)
      .submitRepair(issueId, "A repair has been carried out.", ethers.id("evidence.png"));
    await expect(repairTx).to.emit(campusX, "RepairSubmitted");
    const repairReceipt = await repairTx.wait();
    const repairEvent = repairReceipt.logs
      .map((log) => {
        try {
          return campusX.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "RepairSubmitted");
    expect(repairEvent.args.issueId).to.equal(issueId);
    expect(repairEvent.args.evidenceHash).to.equal(ethers.id("evidence.png"));
    expect(repairEvent.args.repairDescription).to.equal("A repair has been carried out.");
    const issue = await campusX.getIssue(issueId);
    expect(issue.status).to.equal(3n);
    expect(issue.evidenceHash).to.equal(ethers.id("evidence.png"));
    expect(issue.repairSubmittedAt).to.be.greaterThan(0n);
  });

  it("allows only the reporter to confirm a proposed resolution", async function () {
    const issueId = await prepareAwaitingVerification();
    await expect(campusX.connect(other).confirmResolution(issueId)).to.be.revertedWithCustomError(
      campusX,
      "Unauthorized",
    );
    await expect(campusX.connect(reporter).confirmResolution(issueId))
      .to.emit(campusX, "ResolutionConfirmed")
      .withArgs(issueId, reporter.address);
    expect((await campusX.getIssue(issueId)).status).to.equal(4n);
  });

  it("allows only the reporter to dispute and supports an audited reinspection cycle", async function () {
    const issueId = await prepareAwaitingVerification();
    await expect(
      campusX.connect(other).disputeResolution(issueId, "The issue is still present."),
    ).to.be.revertedWithCustomError(campusX, "Unauthorized");
    await expect(campusX.connect(reporter).disputeResolution(issueId, "No"))
      .to.be.revertedWithCustomError(campusX, "InvalidDisputeReason");
    await expect(campusX.connect(reporter).disputeResolution(issueId, "The problem is still present."))
      .to.emit(campusX, "ResolutionDisputed")
      .withArgs(issueId, reporter.address, "The problem is still present.");
    expect((await campusX.getIssue(issueId)).status).to.equal(5n);
    await expect(campusX.connect(other).reopenIssue(issueId, resolver.address)).to.be.revertedWithCustomError(
      campusX,
      "Unauthorized",
    );
    await expect(campusX.connect(admin).reopenIssue(issueId, other.address)).to.be.revertedWithCustomError(
      campusX,
      "ResolverNotAuthorized",
    );
    await campusX.connect(admin).setResolver(other.address, true);
    await expect(campusX.connect(admin).reopenIssue(issueId, other.address))
      .to.emit(campusX, "IssueReopened")
      .withArgs(issueId, admin.address, other.address);
    expect((await campusX.getIssue(issueId)).status).to.equal(6n);
    await campusX.connect(other).setIssueInProgress(issueId);
    await campusX.connect(other).submitRepair(issueId, "Checked the cable and restored power.", ethers.id("v2"));
    expect((await campusX.getIssue(issueId)).status).to.equal(3n);
    await campusX.connect(reporter).confirmResolution(issueId);
    expect((await campusX.getIssue(issueId)).status).to.equal(4n);
  });

  it("allows admin resolver role changes and blocks unauthorized role management", async function () {
    await expect(campusX.connect(other).setResolver(resolver.address, true)).to.be.revertedWithCustomError(
      campusX,
      "Unauthorized",
    );
    await expect(campusX.connect(admin).setResolver(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(
      campusX,
      "ZeroAddress",
    );
    await expect(campusX.connect(admin).setResolver(resolver.address, true))
      .to.emit(campusX, "ResolverAuthorizationChanged")
      .withArgs(resolver.address, admin.address, true);
    expect(await campusX.isResolver(resolver.address)).to.equal(true);
    await campusX.connect(admin).setResolver(resolver.address, false);
    expect(await campusX.isResolver(resolver.address)).to.equal(false);
  });

  it("routes every supported category to a defined campus team", async function () {
    const expectedTeams = [
      "IT & Laboratory Equipment",
      "Electrical Maintenance",
      "Plumbing",
      "Campus Infrastructure",
      "Network & Wi-Fi",
      "General Campus Issues",
    ];
    for (let category = 0; category < expectedTeams.length; category += 1) {
      expect(await campusX.teamForCategory(category)).to.equal(expectedTeams[category]);
    }
    await expect(campusX.teamForCategory(6)).to.be.revertedWithCustomError(campusX, "InvalidCategory");
  });

  it("allows an administrator to reassign an assigned issue without changing its routed team", async function () {
    const { issueId } = await create();
    await campusX.connect(admin).setResolver(resolver.address, true);
    await campusX.connect(admin).setResolver(other.address, true);
    await campusX.connect(admin).assignIssue(issueId, resolver.address);
    await expect(campusX.connect(admin).assignIssue(issueId, other.address))
      .to.emit(campusX, "IssueAssigned")
      .withArgs(issueId, other.address, "IT & Laboratory Equipment");
    const issue = await campusX.getIssue(issueId);
    expect(issue.assignedResolver).to.equal(other.address);
    expect(issue.team).to.equal("IT & Laboratory Equipment");
    expect(issue.status).to.equal(1n);
  });

  it("does not allow an administrator to rewrite assignment after resolver work starts", async function () {
    const { issueId } = await create();
    await campusX.connect(admin).setResolver(resolver.address, true);
    await campusX.connect(admin).setResolver(other.address, true);
    await campusX.connect(admin).assignIssue(issueId, resolver.address);
    await campusX.connect(resolver).setIssueInProgress(issueId);
    await expect(campusX.connect(admin).assignIssue(issueId, other.address)).to.be.revertedWithCustomError(
      campusX,
      "InvalidStatusTransition",
    );
  });

  it("blocks a revoked resolver from taking further assigned actions", async function () {
    const { issueId } = await create();
    await campusX.connect(admin).setResolver(resolver.address, true);
    await campusX.connect(admin).assignIssue(issueId, resolver.address);
    await campusX.connect(admin).setResolver(resolver.address, false);
    await expect(campusX.connect(resolver).setIssueInProgress(issueId)).to.be.revertedWithCustomError(
      campusX,
      "NotAssignedResolver",
    );
  });

  it("only lets the administrator reopen a disputed issue", async function () {
    const { issueId } = await create();
    await expect(campusX.connect(admin).reopenIssue(issueId, resolver.address)).to.be.revertedWithCustomError(
      campusX,
      "InvalidStatusTransition",
    );
  });

  it("prevents reporter confirmation after a dispute has already been recorded", async function () {
    const issueId = await prepareAwaitingVerification();
    await campusX.connect(reporter).disputeResolution(issueId, "The fault is still present.");
    await expect(campusX.connect(reporter).confirmResolution(issueId)).to.be.revertedWithCustomError(
      campusX,
      "InvalidStatusTransition",
    );
    await expect(
      campusX.connect(reporter).disputeResolution(issueId, "The fault is still present."),
    ).to.be.revertedWithCustomError(campusX, "InvalidStatusTransition");
  });

  it("does not accept another repair while the prior repair awaits reporter review", async function () {
    const issueId = await prepareAwaitingVerification();
    await expect(
      campusX.connect(resolver).submitRepair(issueId, "Trying to submit a second repair.", ethers.id("second")),
    ).to.be.revertedWithCustomError(campusX, "InvalidStatusTransition");
  });

  it("returns bounded issue pages and rejects invalid ranges", async function () {
    await create();
    await create();
    expect(await campusX.getIssues(0, 1)).to.have.length(1);
    expect(await campusX.getIssues(1, 10)).to.have.length(1);
    expect(await campusX.getIssues(2, 10)).to.have.length(0);
    await expect(campusX.getIssues(0, 0)).to.be.revertedWithCustomError(campusX, "InvalidPage");
    await expect(campusX.getIssues(0, 101)).to.be.revertedWithCustomError(campusX, "InvalidPage");
    await expect(campusX.getIssues(3, 10)).to.be.revertedWithCustomError(campusX, "InvalidPage");
  });
});
