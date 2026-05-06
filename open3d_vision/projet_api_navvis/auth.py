from backend.app import create_app


def run() -> None:
    """Point d'entree principal du nouveau viewer web 360."""
    app = create_app()
    app.run(host="127.0.0.1", port=8000, debug=True)


if __name__ == "__main__":
    run()