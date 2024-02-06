const { Octokit } = require("@octokit/rest");
const { throttling } = require("@octokit/plugin-throttling");
const fs = require('fs');
const { Parser } = require('@json2csv/plainjs');

const MyOctokit = Octokit.plugin(throttling);
const octokit = new MyOctokit({
    auth: process.env.GITHUB_TOKEN,
    throttle: {
        onRateLimit: (retryAfter, options) => {
            octokit.log.warn(`Request quota exhausted for request ${options.method} ${options.url}`);
            return true;
        },
        onSecondaryRateLimit: (retryAfter, options) => {
            octokit.log.warn(`Secondary request quota exhausted for request ${options.method} ${options.url}`);
            return true;
        }
    }
});

async function getAllPullRequests(owner, repo, since) {
    // const options = octokit.pulls.list.endpoint.merge({ owner, repo, state: 'all', since });
    // const pullRequests = await octokit.paginate(options);
    // Use the search API to get all pull requests in the repo since a certain date
    
    const searchOptions = octokit.search.issuesAndPullRequests.endpoint.merge({ q: `repo:${owner}/${repo} is:pr updated:>${since}` });
    const pullRequests = await octokit.paginate(searchOptions);

    // Aggregate the pull requests
    let pullRequestData = [];
    for (const pullRequest of pullRequests) {
        pullRequestData.push({
            repo: `${owner}/${repo}`,
            number: pullRequest.number,
            title: pullRequest.title,
            user: pullRequest.user.login,
            created_at: pullRequest.created_at,
            updated_at: pullRequest.updated_at,
            closed_at: pullRequest.closed_at,
            merged_at: pullRequest.pull_request.merged_at,
            created_at_date: new Date(pullRequest.created_at).toISOString().split('T')[0],
            updated_at_date: new Date(pullRequest.updated_at).toISOString().split('T')[0],
            closed_at_date: pullRequest.closed_at ? new Date(pullRequest.closed_at).toISOString().split('T')[0] : null,
            merged_at_date: pullRequest.pull_request.merged_at ? new Date(pullRequest.pull_request.merged_at).toISOString().split('T')[0] : null,
            state: pullRequest.state,
            time_to_close: pullRequest.closed_at ? (new Date(pullRequest.closed_at) - new Date(pullRequest.created_at)) / 1000 / 60 / 60 / 24 : null,
            time_to_merge: pullRequest.pull_request.merged_at ? (new Date(pullRequest.pull_request.merged_at) - new Date(pullRequest.created_at)) / 1000 / 60 / 60 / 24 : null,
            merged: pullRequest.pull_request.merged_at ? true : false,
            closed: pullRequest.closed_at ? true : false
        });

        // Find the number of reviews that requested changes
        const reviewsOptions = octokit.pulls.listReviews.endpoint.merge({ owner, repo, pull_number: pullRequest.number });
        const reviews = await octokit.paginate(reviewsOptions);
  
        pullRequestData[pullRequestData.length - 1].num_reviews = reviews.length;
        pullRequestData[pullRequestData.length - 1].num_approvals = reviews.filter(r => r.state === 'APPROVED').length;
        pullRequestData[pullRequestData.length - 1].num_dismissed = reviews.filter(r => r.state === 'DISMISSED').length;
        pullRequestData[pullRequestData.length - 1].num_changes_requested = reviews.filter(r => r.state === 'CHANGES_REQUESTED').length;
    }

    return pullRequestData;
}

async function getAllPullRequestsInOrg(org, since) {
    // Iterate over all repos in the org
    const options = octokit.repos.listForOrg.endpoint.merge({ org, since });
    const repos = await octokit.paginate(options);

    let allPullRequests = [];
    for (const repo of repos) {
        console.log(`Getting pull requests for ${repo.name}`);
        allPullRequests = allPullRequests.concat(await getAllPullRequests(org, repo.name, since));
    }

    if (!fs.existsSync('./data')) {
        fs.mkdirSync('./data');
    }

    fs.writeFileSync(`./data/${org}-pulls.json`, JSON.stringify(allPullRequests, null, 2));

    const parser = new Parser({header: true, includeEmptyRows: false});
    const csv = parser.parse(allPullRequests);
    fs.writeFileSync(`./data/${org}-pulls.csv`, csv);

    console.log('Done!');
}

const since = new Date('2024-01-01').toISOString();
getAllPullRequestsInOrg('dapr', since); 
