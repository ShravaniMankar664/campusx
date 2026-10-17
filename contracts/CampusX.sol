// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title CAMPUSX - on-chain campus issue accountability
/// @notice Stores issue workflow, authorization, community votes, and evidence
/// commitments. It does not establish reporter anonymity or prove physical work.
contract CampusX {
    uint8 public constant CATEGORY_COUNT = 6;
    uint8 public constant MAX_PAGE_SIZE = 100;

    enum Status {
        Reported,
        Assigned,
        InProgress,
        AwaitingVerification,
        VerifiedResolved,
        Disputed,
        Reinspection
    }

    struct Issue {
        uint256 id;
        string title;
        string description;
        uint8 category;
        string location;
        uint8 severity;
        uint64 createdAt;
        address reporter;
        Status status;
        address assignedResolver;
        string team;
        uint32 voteCount;
        string repairDescription;
        bytes32 evidenceHash;
        uint64 repairSubmittedAt;
    }

    address public immutable administrator;
    uint256 public issueCount;

    mapping(address => bool) public isResolver;
    mapping(uint256 => Issue) private issues;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    error Unauthorized();
    error ZeroAddress();
    error InvalidIssueId();
    error InvalidTitle();
    error InvalidDescription();
    error InvalidLocation();
    error InvalidCategory();
    error InvalidSeverity();
    error InvalidPage();
    error InvalidStatusTransition();
    error ResolverNotAuthorized();
    error NotAssignedResolver();
    error AlreadyVoted();
    error EvidenceHashRequired();
    error InvalidRepairDescription();
    error InvalidDisputeReason();

    event IssueCreated(
        uint256 indexed issueId,
        address indexed reporter,
        uint8 category,
        uint8 severity,
        string team
    );
    event IssueAssigned(
        uint256 indexed issueId,
        address indexed resolver,
        string team
    );
    event IssueStatusChanged(
        uint256 indexed issueId,
        Status previousStatus,
        Status newStatus,
        address indexed actor
    );
    event VoteRecorded(
        uint256 indexed issueId,
        address indexed voter,
        uint32 voteCount
    );
    event RepairSubmitted(
        uint256 indexed issueId,
        address indexed resolver,
        bytes32 evidenceHash,
        string repairDescription,
        uint64 submittedAt
    );
    event ResolutionConfirmed(uint256 indexed issueId, address indexed reporter);
    event ResolutionDisputed(
        uint256 indexed issueId,
        address indexed reporter,
        string reason
    );
    event IssueReopened(
        uint256 indexed issueId,
        address indexed administrator,
        address indexed resolver
    );
    event ResolverAuthorizationChanged(
        address indexed resolver,
        address indexed administrator,
        bool authorized
    );

    modifier onlyAdministrator() {
        if (msg.sender != administrator) revert Unauthorized();
        _;
    }

    constructor() {
        administrator = msg.sender;
    }

    /// @notice Category-to-team routing is deterministic and visible on-chain.
    function teamForCategory(uint8 category) public pure returns (string memory) {
        if (category >= CATEGORY_COUNT) revert InvalidCategory();
        if (category == 0) return "IT & Laboratory Equipment";
        if (category == 1) return "Electrical Maintenance";
        if (category == 2) return "Plumbing";
        if (category == 3) return "Campus Infrastructure";
        if (category == 4) return "Network & Wi-Fi";
        return "General Campus Issues";
    }

    function createIssue(
        string calldata title,
        string calldata description,
        uint8 category,
        string calldata location,
        uint8 severity
    ) external returns (uint256 issueId) {
        uint256 titleLength = bytes(title).length;
        uint256 descriptionLength = bytes(description).length;
        uint256 locationLength = bytes(location).length;

        if (titleLength < 5 || titleLength > 80) revert InvalidTitle();
        if (descriptionLength < 10 || descriptionLength > 1400) {
            revert InvalidDescription();
        }
        if (locationLength < 2 || locationLength > 120) revert InvalidLocation();
        if (category >= CATEGORY_COUNT) revert InvalidCategory();
        if (severity > 3) revert InvalidSeverity();

        issueId = ++issueCount;
        string memory team = teamForCategory(category);

        issues[issueId] = Issue({
            id: issueId,
            title: title,
            description: description,
            category: category,
            location: location,
            severity: severity,
            createdAt: uint64(block.timestamp),
            reporter: msg.sender,
            status: Status.Reported,
            assignedResolver: address(0),
            team: team,
            voteCount: 0,
            repairDescription: "",
            evidenceHash: bytes32(0),
            repairSubmittedAt: 0
        });

        emit IssueCreated(issueId, msg.sender, category, severity, team);
    }

    function setResolver(address resolver, bool authorized) external onlyAdministrator {
        if (resolver == address(0)) revert ZeroAddress();
        isResolver[resolver] = authorized;
        emit ResolverAuthorizationChanged(resolver, msg.sender, authorized);
    }

    /// @notice Assigns or reassigns an issue that has not entered repair work.
    function assignIssue(uint256 issueId, address resolver) external onlyAdministrator {
        Issue storage issue = _issue(issueId);
        if (issue.status != Status.Reported && issue.status != Status.Assigned) {
            revert InvalidStatusTransition();
        }
        _requireAuthorizedResolver(resolver);

        issue.assignedResolver = resolver;
        if (issue.status == Status.Reported) {
            _setStatus(issue, Status.Assigned, msg.sender);
        }
        emit IssueAssigned(issueId, resolver, issue.team);
    }

    function setIssueInProgress(uint256 issueId) external {
        Issue storage issue = _issue(issueId);
        if (issue.assignedResolver != msg.sender || !isResolver[msg.sender]) {
            revert NotAssignedResolver();
        }
        if (issue.status != Status.Assigned && issue.status != Status.Reinspection) {
            revert InvalidStatusTransition();
        }
        _setStatus(issue, Status.InProgress, msg.sender);
    }

    function voteForIssue(uint256 issueId) external {
        Issue storage issue = _issue(issueId);
        if (issue.status == Status.VerifiedResolved) revert InvalidStatusTransition();
        if (hasVoted[issueId][msg.sender]) revert AlreadyVoted();

        hasVoted[issueId][msg.sender] = true;
        issue.voteCount += 1;
        emit VoteRecorded(issueId, msg.sender, issue.voteCount);
    }

    function submitRepair(
        uint256 issueId,
        string calldata repairDescription,
        bytes32 evidenceHash
    ) external {
        Issue storage issue = _issue(issueId);
        if (issue.assignedResolver != msg.sender || !isResolver[msg.sender]) {
            revert NotAssignedResolver();
        }
        if (issue.status != Status.InProgress) revert InvalidStatusTransition();
        uint256 descriptionLength = bytes(repairDescription).length;
        if (descriptionLength < 10 || descriptionLength > 1000) {
            revert InvalidRepairDescription();
        }
        if (evidenceHash == bytes32(0)) revert EvidenceHashRequired();

        issue.repairDescription = repairDescription;
        issue.evidenceHash = evidenceHash;
        issue.repairSubmittedAt = uint64(block.timestamp);
        _setStatus(issue, Status.AwaitingVerification, msg.sender);
        emit RepairSubmitted(
            issueId,
            msg.sender,
            evidenceHash,
            repairDescription,
            uint64(block.timestamp)
        );
    }

    function confirmResolution(uint256 issueId) external {
        Issue storage issue = _issue(issueId);
        if (issue.reporter != msg.sender) revert Unauthorized();
        if (issue.status != Status.AwaitingVerification) {
            revert InvalidStatusTransition();
        }
        _setStatus(issue, Status.VerifiedResolved, msg.sender);
        emit ResolutionConfirmed(issueId, msg.sender);
    }

    function disputeResolution(uint256 issueId, string calldata reason) external {
        Issue storage issue = _issue(issueId);
        if (issue.reporter != msg.sender) revert Unauthorized();
        if (issue.status != Status.AwaitingVerification) {
            revert InvalidStatusTransition();
        }
        uint256 reasonLength = bytes(reason).length;
        if (reasonLength < 5 || reasonLength > 500) revert InvalidDisputeReason();
        _setStatus(issue, Status.Disputed, msg.sender);
        emit ResolutionDisputed(issueId, msg.sender, reason);
    }

    /// @notice Starts an auditable reinspection cycle after a reporter dispute.
    function reopenIssue(uint256 issueId, address resolver) external onlyAdministrator {
        Issue storage issue = _issue(issueId);
        if (issue.status != Status.Disputed) revert InvalidStatusTransition();
        _requireAuthorizedResolver(resolver);

        issue.assignedResolver = resolver;
        _setStatus(issue, Status.Reinspection, msg.sender);
        emit IssueReopened(issueId, msg.sender, resolver);
        emit IssueAssigned(issueId, resolver, issue.team);
    }

    function getIssue(uint256 issueId) external view returns (Issue memory) {
        return _issue(issueId);
    }

    /// @notice Returns a bounded page; offset is zero-based and IDs start at one.
    function getIssues(uint256 offset, uint256 limit)
        external
        view
        returns (Issue[] memory page)
    {
        if (limit == 0 || limit > MAX_PAGE_SIZE || offset > issueCount) {
            revert InvalidPage();
        }
        uint256 available = issueCount - offset;
        uint256 count = available < limit ? available : limit;
        page = new Issue[](count);
        for (uint256 index; index < count; ++index) {
            page[index] = issues[offset + index + 1];
        }
    }

    function _issue(uint256 issueId) private view returns (Issue storage issue) {
        if (issueId == 0 || issueId > issueCount) revert InvalidIssueId();
        issue = issues[issueId];
    }

    function _requireAuthorizedResolver(address resolver) private view {
        if (resolver == address(0)) revert ZeroAddress();
        if (!isResolver[resolver]) revert ResolverNotAuthorized();
    }

    function _setStatus(Issue storage issue, Status newStatus, address actor) private {
        Status previousStatus = issue.status;
        issue.status = newStatus;
        emit IssueStatusChanged(issue.id, previousStatus, newStatus, actor);
    }
}
