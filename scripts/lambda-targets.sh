# Shared defaults for the console-managed Lambdas. No credentials belong here.
lambdaRegion="us-east-2"
lambdaProfile="music-discovery"
ingestionFunction="arn:aws:lambda:us-east-2:783161622181:function:musicRssFetcher"
matcherFunction="arn:aws:lambda:us-east-2:783161622181:function:trackMatcher"
