#!/bin/sh
# Build the output file
bun build google-app-script.ts > google-app-script.gs

#!/bin/sh

# The JSON file with the mapping
json_file="gs-function-mapping.json"

# The file to modify
file_to_modify="google-app-script.gs"

# Use Python to read the JSON file and generate a series of sed commands
sed_commands=$(python -c "
import json
with open('$json_file') as f:
    data = json.load(f)
for key, value in data.items():
    print('s/' + key + '/' + value + '/g')
")

# Use eval and sed to execute the sed commands and modify the file
eval "sed -i '$sed_commands' $file_to_modify"

# Count the total number of lines in the file
total_lines=$(wc -l < "$file_to_modify")

# Subtract 4 from the total number of lines
lines_to_keep=$((total_lines - 4))

# Use the head command to keep only the first 'lines_to_keep' lines
head -n "$lines_to_keep" "$file_to_modify" > temp.txt && mv temp.txt "$file_to_modify"