import sys
import pickle
import os

# Path to your users.pkl file — resolve next to this script so it matches
# the path the detection service (face2025old.py) loads from.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PKL_PATH = os.environ.get("USERS_PKL_PATH", os.path.join(BASE_DIR, "users.pkl"))

def delete_user(name):
    if not os.path.exists(PKL_PATH):
        print(f"[INFO] Pickle file not found at {PKL_PATH}")
        return

    try:
        with open(PKL_PATH, "rb") as f:
            users = pickle.load(f)

        if name in users:
            del users[name] # Remove the key from the dictionary
            with open(PKL_PATH, "wb") as f:
                pickle.dump(users, f)
            print(f"[SUCCESS] Deleted '{name}' from embeddings.")
        else:
            print(f"[INFO] User '{name}' not found in embeddings.")

    except Exception as e:
        print(f"[ERROR] Failed to modify pickle file: {e}")

if __name__ == "__main__":
    # Expects: python manage_embeddings.py delete "NameOfPerson"
    if len(sys.argv) < 3:
        print("Usage: manage_embeddings.py <action> <name>")
        sys.exit(1)

    action = sys.argv[1]
    target_name = sys.argv[2]

    if action == "delete":
        delete_user(target_name)
