#!/bin/zsh

# Check if nordpool-cf directory was modified in the commits being pushed
# Standard input provides: <local ref> <local sha1> <remote ref> <remote sha1>

while read local_ref local_sha remote_ref remote_sha
do
    if [[ "$local_sha" == "0000000000000000000000000000000000000000" ]]; then
        # Branch deletion
        continue
    fi

    # Handle first push to a new branch
    if [[ "$remote_sha" == "0000000000000000000000000000000000000000" ]]; then
        # Check against HEAD or previous commit if possible, but simplest is just checking all files in nordpool-cf/
        has_changes=true
    else
        # Check for changes in nordpool-cf/ directory between the remote state and local state
        if git diff --name-only "$remote_sha" "$local_sha" | grep -q "^nordpool-cf/"; then
            has_changes=true
        else
            has_changes=false
        fi
    fi

    if [[ "$has_changes" == true ]]; then
        echo "Push includes changes to nordpool-cf/. Deploying Cloudflare Worker..."
        (cd nordpool-cf && npm run deploy) || {
            echo "--------------------------------------------------"
            echo "ERR: Cloudflare deployment failed! Aborting push."
            echo "--------------------------------------------------"
            exit 1
        }
    fi
done

exit 0
