import httpx, os
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

base  = os.getenv('JIRA_BASE_URL', '').rstrip('/')
email = os.getenv('JIRA_EMAIL', '')
token = os.getenv('JIRA_API_TOKEN', '')

print(f"JIRA_BASE_URL : {base}")
print(f"JIRA_EMAIL    : {email}")

jql = 'text ~ "Disabling Attribute"'
r = httpx.get(
    f'{base}/rest/api/3/search/jql',
    params={'jql': jql, 'maxResults': 3, 'fields': 'summary,status'},
    auth=(email, token),
    headers={'Accept': 'application/json'},
    timeout=15,
)
print(f"STATUS: {r.status_code}")
print(f"BODY  : {r.text[:600]}")
