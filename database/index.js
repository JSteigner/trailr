/* eslint-disable camelcase */
/* eslint-disable no-shadow */
/* eslint-disable no-console */
const mysql = require('mysql');

/**
 *
*/
let poolConnection;
if (!process.env.NODE_ENV) {
  poolConnection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'trailr',
  });
} else if (process.env.NODE_ENV === 'PROD_LOCAL') {
  poolConnection = mysql.createPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: '34.70.176.46',
  });
} else {
  poolConnection = mysql.createPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    socketPath: `/cloudsql/${process.env.DB_INSTANCE_CONNECTION_NAME}`,
  });
}

const getUser = (id) => new Promise((resolve, reject) => {
  poolConnection.getConnection((error, connection) => {
    if (error) reject(error);

    const getUserCommand = `
      SELECT *
      FROM users
      WHERE id = ?
    `;
    const getPhotosCommand = `
      SELECT *
      FROM photos
      WHERE id_user = ?
    `;
    const getCommentsCommand = `
      SELECT users.*, comments.*
      FROM comments
      LEFT JOIN users ON comments.id_user = users.id
      WHERE id_photo = ?
    `;

    const getFavoritesCommand = `
      SELECT trails.*
      FROM favorites
      LEFT JOIN trails ON favorites.id_trail = trails.id
      WHERE favorites.id_user = ?
    `;

    connection.beginTransaction((error) => {
      if (error) {
        connection.rollback(() => {
          connection.release();
          resolve(error);
        });
      }
      connection.query(getUserCommand, [id], (error, gottenUser) => {
        if (error) {
          connection.rollback(() => {
            connection.release();
            resolve(error);
          });
        }
        if (!gottenUser.length) {
          connection.commit((error) => {
            if (error) {
              connection.rollback(() => {
                connection.release();
                resolve(error);
              });
            }
            resolve(gottenUser);
          });
        } else if (gottenUser.length > 0) {
          const user = gottenUser[0];
          connection.query(getFavoritesCommand, [id], (error, gottenFavorites) => {
            if (error) {
              connection.rollback(() => {
                connection.release();
                resolve(error);
              });
            }
            user.favorites = gottenFavorites;
            connection.query(getPhotosCommand, [id], (error, gottenPhotos) => {
              if (error) {
                connection.rollback(() => {
                  connection.release();
                  resolve(error);
                });
              }
              user.photos = gottenPhotos;
              if (!gottenPhotos.length) {
                connection.commit((error) => {
                  if (error) {
                    connection.rollback(() => {
                      connection.release();
                      resolve(error);
                    });
                  }
                  resolve(user);
                });
              }
              user.photos.forEach((photo, i) => {
                const { id } = photo;
                connection.query(getCommentsCommand, [id], (error, gottenComments) => {
                  if (error) {
                    connection.rollback(() => {
                      connection.release();
                      resolve(error);
                    });
                  }
                  user.photos[i].comments = gottenComments;
                  if (i === user.photos.length - 1) {
                    connection.commit((error) => {
                      if (error) {
                        connection.rollback(() => {
                          connection.release();
                          resolve(error);
                        });
                      }
                      resolve(user);
                    });
                  }
                });
              });
            });
          });
        }
      });
    });
  });
});

const addUser = (userObject) => new Promise((resolve, reject) => {
  poolConnection.getConnection((error, connection) => {
    if (error) reject(error);

    const checkUserCommand = `
      SELECT *
      FROM users
      WHERE google_id = ?
    `;
    const addUserCommand = `
      INSERT INTO users (google_id, name, profile_photo_url)
      VALUES (?, ?, ?)
    `;

    connection.beginTransaction((error) => {
      if (error) {
        connection.rollback(() => {
          connection.release();
          resolve(error);
        });
      }
      connection.query(checkUserCommand, [userObject.google_id], (error, userResult) => {
        if (error) {
          connection.rollback(() => {
            connection.release();
            resolve(error);
          });
        }
        if (userResult.length > 0) {
          connection.commit((error) => {
            if (error) {
              connection.rollback(() => {
                connection.release();
                resolve(error);
              });
            }
            resolve({
              message: 'Existing user. Use id listed here with getUser(id) to lookup user or updateUser(id) to update user.',
              id: userResult[0].id,
              name: userResult[0].name,
            });
          });
        } else if (!userResult.length) {
          connection.query(addUserCommand,
            [userObject.google_id, userObject.name, userObject.profile_photo_url],
            (error, addedUser) => {
              if (error) {
                connection.rollback(() => {
                  connection.release();
                  resolve(error);
                });
              }
              connection.commit((error) => {
                if (error) {
                  connection.rollback(() => {
                    connection.release();
                    resolve(error);
                  });
                }
                resolve({ id: addedUser.insertId, name: userObject.name });
              });
            });
        }
      });
    });
  });
});

const getTrail = (trailObject) => new Promise((resolve, reject) => {
  poolConnection.getConnection((error, connection) => {
    if (error) reject(error);

    const { id_trail, id_user } = trailObject;

    const getTrailCommand = `
      SELECT *,
      (
        SELECT CAST(CAST(ROUND(AVG(value), 1) AS DECIMAL(2,1)) AS CHAR)
        FROM rating_difficulty
        WHERE id_trail = ?
      ) AS averageDifficulty,
      (
        SELECT CAST(CAST(ROUND(AVG(value), 1) AS DECIMAL(2,1)) AS CHAR)
        FROM rating_likeability
        WHERE id_trail = ?
      ) AS averageLikeability,
      (
        SELECT IFNULL((SELECT value
          FROM rating_difficulty
          WHERE id_user = ?
          AND id_trail = ?), 'Rate this trail:')
      ) as userDifficulty,
      (
        SELECT IFNULL((SELECT value
          FROM rating_likeability
          WHERE id_user = ?
          AND id_trail = ?), 'Rate this trail:')
      ) as userLikeability
      FROM trails
      WHERE id = ?
    `;

    const getPhotosCommand = `
      SELECT users.*, photos.*
      FROM photos
      LEFT JOIN users ON photos.id_user = users.id
      LEFT JOIN trails ON photos.id_trail = trails.id
      WHERE trails.id = ?
    `;

    const getCommentsCommand = `
      SELECT users.*, comments.*
      FROM comments
      LEFT JOIN users ON comments.id_user = users.id
      WHERE id_photo = ?
    `;

    connection.beginTransaction((error) => {
      if (error) {
        connection.rollback(() => {
          connection.release();
          resolve(error);
        });
      }
      connection.query(getTrailCommand,
        [id_trail, id_trail, id_user, id_trail, id_user, id_trail, id_trail],
        (error, gottenTrail) => {
          if (error) {
            connection.rollback(() => {
              connection.release();
              resolve(error);
            });
          }
          if (!gottenTrail.length) {
            connection.commit((error) => {
              if (error) {
                connection.rollback(() => {
                  connection.release();
                  resolve(error);
                });
              }
              resolve(gottenTrail);
            });
          } else if (gottenTrail.length > 0) {
            const trail = gottenTrail[0];
            const { id } = trail;
            connection.query(getPhotosCommand, [id], (error, gottenPhotos) => {
              if (error) {
                connection.rollback(() => {
                  connection.release();
                  resolve(error);
                });
              }
              if (!gottenPhotos.length) {
                connection.commit((error) => {
                  if (error) {
                    connection.rollback(() => {
                      connection.release();
                      resolve(error);
                    });
                  }
                  resolve(trail);
                });
              }
              trail.photos = gottenPhotos;
              trail.photos.forEach((photo, i) => {
                const { id } = photo;
                connection.query(getCommentsCommand, [id], (error, gottenComments) => {
                  if (error) {
                    connection.rollback(() => {
                      connection.release();
                      resolve(error);
                    });
                  }
                  trail.photos[i].comments = gottenComments;
                  if (i === trail.photos.length - 1) {
                    connection.commit((error) => {
                      if (error) {
                        connection.rollback(() => {
                          connection.release();
                          resolve(error);
                        });
                      }
                      resolve(trail);
                    });
                  }
                });
              });
            });
          }
        });
    });
  });
});

const addTrail = (trailObject) => new Promise((resolve, reject) => {
  poolConnection.getConnection((error, connection) => {
    if (error) reject(error);

    const checkTrailCommand = `
      SELECT *
      FROM trails
      WHERE api_id = ?
    `;
    const addTrailCommand = `
      INSERT INTO trails (api_id, name, city, region, country, latitude, longitude, url, thumbnail, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    connection.beginTransaction((error) => {
      if (error) {
        connection.rollback(() => {
          connection.release();
          resolve(error);
        });
      }
      connection.query(checkTrailCommand, [trailObject.api_id], (error, trailResult) => {
        if (error) {
          connection.rollback(() => {
            connection.release();
            resolve(error);
          });
        }
        if (trailResult.length > 0) {
          connection.commit((error) => {
            if (error) {
              connection.rollback(() => {
                connection.release();
                resolve(error);
              });
            }
            resolve({
              message: 'Existing trail. Use id listed here with getTrail(id) to lookup trail or updateTrail(id) to update trail.',
              id: trailResult[0].id,
            });
          });
        } else if (!trailResult.length) {
          connection.query(addTrailCommand,
            [trailObject.api_id, trailObject.name, trailObject.city, trailObject.region,
              trailObject.country, trailObject.latitude, trailObject.longitude,
              trailObject.url, trailObject.thumbnail, trailObject.description],
            (error, addedTrail) => {
              if (error) {
                connection.rollback(() => {
                  connection.release();
                  resolve(error);
                });
              }
              connection.commit((error) => {
                if (error) {
                  connection.rollback(() => {
                    connection.release();
                    resolve(error);
                  });
                }
                resolve({ id: addedTrail.insertId });
              });
            });
        }
      });
    });
  });
});

const updateTrail = (trailObject) => new Promise((resolve, reject) => {
  poolConnection.getConnection((error, connection) => {
    if (error) reject(error);

    const updateTrailCommand = `
      UPDATE trails
      SET
        api_id = ?,
        name = ?,
        city = ?,
        region = ?,
        country = ?,
        latitude = ?,
        longitude = ?,
        url = ?,
        thumbnail = ?,
        description = ?,
        status = ?
      WHERE id = ?
    `;

    connection.beginTransaction((error) => {
      if (error) {
        connection.rollback(() => {
          connection.release();
          resolve(error);
        });
      }
      connection.query(updateTrailCommand,
        [trailObject.api_id, trailObject.name, trailObject.city, trailObject.region,
          trailObject.country, trailObject.latitude, trailObject.longitude, trailObject.url,
          trailObject.thumbnail, trailObject.description, trailObject.status, trailObject.id],
        (error, updatedTrail) => {
          if (error) {
            connection.rollback(() => {
              connection.release();
              resolve(error);
            });
          }
          connection.commit((error) => {
            if (error) {
              connection.rollback(() => {
                connection.release();
                resolve(error);
              });
            }
            console.log('UPDATED TRAIL: ', updatedTrail);
            const updateTrailResult = updatedTrail || [{ affectedRows: 0 }];
            resolve(updateTrailResult);
          });
        });
    });
  });
});

const deleteTrail = (id) => new Promise((resolve, reject) => {
  poolConnection.getConnection((error, connection) => {
    if (error) reject(error);

    console.log('DELETE TRAIL INVOKED');
    const deleteTrailCommand = `
      DELETE FROM trails
      WHERE id = ?
    `;
    connection.beginTransaction((error) => {
      if (error) {
        connection.rollback(() => {
          connection.release();
          resolve(error);
        });
      }
      connection.query(deleteTrailCommand, [id], (error, deletedTrailData) => {
        if (error) {
          connection.rollback(() => {
            connection.release();
            resolve(error);
          });
        }
        connection.commit((error) => {
          if (error) {
            connection.rollback(() => {
              connection.release();
              resolve(error);
            });
          }
          resolve(deletedTrailData);
        });
      });
    });
  });
});

const updateDifficulty = (difficultyObject) => new Promise((resolve, reject) => {
  poolConnection.getConnection((error, connection) => {
    if (error) reject(error);

    const { id_user, id_trail, value } = difficultyObject;

    const checkDifficultyCommand = `
      SELECT *
      FROM rating_difficulty
      WHERE id_user = ? AND id_trail = ?
    `;

    const addDifficultyCommand = `
      INSERT INTO rating_difficulty (id_user, id_trail, value)
      VALUES (?, ?, ?)
    `;

    const updateDifficultyCommand = `
      UPDATE rating_difficulty
      SET value = ?
      WHERE id_user = ? AND id_trail = ?
    `;

    const getAvgDiffCommand = `
        SELECT CAST(CAST(ROUND(AVG(value), 1) AS DECIMAL(2,1)) AS CHAR) AS averageDifficulty
        FROM rating_difficulty
        WHERE id_trail = ?
    `;

    connection.beginTransaction((error) => {
      if (error) {
        connection.rollback(() => {
          connection.release();
          resolve(error);
        });
      }
      connection.query(checkDifficultyCommand,
        [id_user, id_trail],
        (error, difficultyResult) => {
          if (error) {
            connection.rollback(() => {
              connection.release();
              resolve(error);
            });
          }
          let affectedRows;
          let message;
          if (!difficultyResult.length) {
            connection.query(addDifficultyCommand,
              [id_user, id_trail, value], (error, addDiffMessage) => {
                if (error) {
                  connection.rollback(() => {
                    connection.release();
                    resolve(error);
                  });
                }
                affectedRows = addDiffMessage ? addDiffMessage.affectedRows : 0;
                message = addDiffMessage ? addDiffMessage.message : 0;
              });
          } else if (difficultyResult.length > 0) {
            connection.query(updateDifficultyCommand,
              [value, id_user, id_trail],
              (error, updateDiffMessage) => {
                if (error) {
                  connection.rollback(() => {
                    connection.release();
                    resolve(error);
                  });
                }
                affectedRows = updateDiffMessage ? updateDiffMessage.affectedRows : 0;
                message = updateDiffMessage ? updateDiffMessage.message : 0;
              });
          }
          connection.query(getAvgDiffCommand,
            [id_trail],
            (error, newDiffAverage) => {
              if (error) {
                connection.rollback(() => {
                  connection.release();
                  resolve(error);
                });
              }
              connection.commit((error) => {
                if (error) {
                  connection.rollback(() => {
                    connection.release();
                    resolve(error);
                  });
                }
                const newDiffReturn = newDiffAverage[0] ? newDiffAverage : [{}];
                newDiffReturn[0].affectedRows = affectedRows;
                newDiffReturn[0].queryMessage = message;
                resolve(newDiffReturn);
              });
            });
        });
    });
  });
});

const updateLikeability = (likeabilityObject) => new Promise((resolve, reject) => {
  poolConnection.getConnection((error, connection) => {
    if (error) reject(error);

    const { id_user, id_trail, value } = likeabilityObject;

    const checkLikeabilityCommand = `
      SELECT *
      FROM rating_likeability
      WHERE id_user = ? AND id_trail = ?
    `;

    const addLikeabilityCommand = `
      INSERT INTO rating_likeability (id_user, id_trail, value)
      VALUES (?, ?, ?)
    `;

    const updateLikeabilityCommand = `
      UPDATE rating_likeability
      SET value = ?
      WHERE id_user = ? AND id_trail = ?
    `;

    const getAvgLikeCommand = `
      SELECT CAST(CAST(ROUND(AVG(value), 1) AS DECIMAL(2,1)) AS CHAR) AS averageLikeability
      FROM rating_likeability
      WHERE id_trail = ?
  `;

    connection.beginTransaction((error) => {
      if (error) {
        connection.rollback(() => {
          connection.release();
          resolve(error);
        });
      }
      connection.query(checkLikeabilityCommand,
        [id_user, id_trail],
        (error, likeabilityResult) => {
          if (error) {
            connection.rollback(() => {
              connection.release();
              resolve(error);
            });
          }
          let affectedRows;
          let message;
          if (!likeabilityResult.length) {
            connection.query(addLikeabilityCommand,
              [id_user, id_trail, value], (error, addLikeMessage) => {
                if (error) {
                  connection.rollback(() => {
                    connection.release();
                    resolve(error);
                  });
                }
                affectedRows = addLikeMessage ? addLikeMessage.affectedRows : 0;
                message = addLikeMessage ? addLikeMessage.message : 0;
              });
          } else if (likeabilityResult.length > 0) {
            connection.query(updateLikeabilityCommand,
              [value, id_user, id_trail],
              (error, updateLikeMessage) => {
                if (error) {
                  connection.rollback(() => {
                    connection.release();
                    resolve(error);
                  });
                }
                affectedRows = updateLikeMessage ? updateLikeMessage.affectedRows : 0;
                message = updateLikeMessage ? updateLikeMessage.message : 0;
              });
          }
          connection.query(getAvgLikeCommand,
            [id_trail],
            (error, newLikeAverage) => {
              if (error) {
                connection.rollback(() => {
                  connection.release();
                  resolve(error);
                });
              }
              connection.commit((error) => {
                if (error) {
                  connection.rollback(() => {
                    connection.release();
                    resolve(error);
                  });
                }
                const newLikeReturn = newLikeAverage[0] ? newLikeAverage : [{}];
                newLikeReturn[0].affectedRows = affectedRows;
                newLikeReturn[0].message = message;
                resolve(newLikeReturn);
              });
            });
        });
    });
  });
});

const addComment = (commentObject) => new Promise((resolve, reject) => {
  poolConnection.getConnection((error, connection) => {
    if (error) reject(error);

    const { text, id_user, id_photo } = commentObject;

    const addCommentCommand = `
      INSERT INTO comments (text, id_user, id_photo)
      VALUES (?, ?, ?)
    `;

    connection.beginTransaction((error) => {
      if (error) {
        connection.rollback(() => {
          connection.release();
          resolve(error);
        });
      }
      connection.query(addCommentCommand,
        [text, id_user, id_photo],
        (error, addedComment) => {
          if (error) {
            connection.rollback(() => {
              connection.release();
              resolve(error);
            });
          }
          connection.commit((error) => {
            if (error) {
              connection.rollback(() => {
                connection.release();
                resolve(error);
              });
            }
            resolve({ id: `${addedComment.insertId}` });
          });
        });
    });
  });
});

const addPhoto = (photoObject) => new Promise((resolve, reject) => {
  poolConnection.getConnection((error, connection) => {
    if (error) reject(error);

    const addPhotoCommand = `
      INSERT INTO photos (url, description, lat, lng, id_user, id_trail)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    connection.beginTransaction((error) => {
      if (error) {
        connection.rollback(() => {
          connection.release();
          resolve(error);
        });
      }
      connection.query(addPhotoCommand,
        [photoObject.url, photoObject.description, photoObject.lat,
          photoObject.lng, photoObject.id_user, photoObject.id_trail],
        (error, addedPhoto) => {
          if (error) {
            connection.rollback(() => {
              connection.release();
              resolve(error);
            });
          }
          connection.commit((error) => {
            if (error) {
              connection.rollback(() => {
                connection.release();
                resolve(error);
              });
            }
            resolve({ id: `${addedPhoto.insertId}` });
          });
        });
    });
  });
});

const deleteComment = (id) => new Promise((resolve, reject) => {
  poolConnection.getConnection((error, connection) => {
    if (error) reject(error);

    const deleteCommentCommand = `
      DELETE FROM comments
      WHERE id = ?
    `;
    connection.beginTransaction((error) => {
      if (error) {
        connection.rollback(() => {
          connection.release();
          resolve(error);
        });
      }
      connection.query(deleteCommentCommand, [id], (error, deletedCommentData) => {
        if (error) {
          connection.rollback(() => {
            connection.release();
            resolve(error);
          });
        }
        connection.commit((error) => {
          if (error) {
            connection.rollback(() => {
              connection.release();
              resolve(error);
            });
          }
          resolve(deletedCommentData);
        });
      });
    });
  });
});

const deletePhoto = (id) => new Promise((resolve, reject) => {
  poolConnection.getConnection((error, connection) => {
    if (error) reject(error);

    const deleteCommentsCommand = `
      DELETE FROM comments
      where id_photo = ?
  `;
    const deletePhotoCommand = `
      DELETE FROM photos
      WHERE id = ?
    `;

    connection.beginTransaction((error) => {
      if (error) {
        connection.rollback(() => {
          connection.release();
          resolve(error);
        });
      }
      connection.query(deleteCommentsCommand, [id], (error, deletedCommentData) => {
        if (error) {
          connection.rollback(() => {
            connection.release();
            resolve(error);
          });
        }
        connection.query(deletePhotoCommand, [id], (error, deletedPhotoData) => {
          if (error) {
            connection.rollback(() => {
              connection.release();
              resolve(error);
            });
          }
          connection.commit((error) => {
            if (error) {
              connection.rollback(() => {
                connection.release();
                resolve(error);
              });
            }
            const deletionResults = deletedPhotoData;
            deletionResults.deletedComments = deletedCommentData;
            resolve(deletionResults);
          });
        });
      });
    });
  });
});

const addFavorite = (favoriteObject) => new Promise((resolve, reject) => {
  poolConnection.getConnection((error, connection) => {
    if (error) reject(error);

    const { id_user, id_trail } = favoriteObject;

    const addFavoriteCommand = `
      INSERT INTO favorites (id_user, id_trail)
      VALUES (?, ?)
    `;

    connection.beginTransaction((error) => {
      if (error) {
        connection.rollback(() => {
          connection.release();
          resolve(error);
        });
      }
      connection.query(addFavoriteCommand,
        [id_user, id_trail],
        (error, addedFavorite) => {
          if (error) {
            connection.rollback(() => {
              connection.release();
              resolve(error);
            });
          }
          connection.commit((error) => {
            if (error) {
              connection.rollback(() => {
                connection.release();
                resolve(error);
              });
            }
            resolve({ id: `${addedFavorite.insertId}` });
          });
        });
    });
  });
});

const deleteFavorite = (favoriteObject) => new Promise((resolve, reject) => {
  poolConnection.getConnection((error, connection) => {
    if (error) reject(error);

    const { id_user, id_trail } = favoriteObject;

    const deleteFavoriteCommand = `
      DELETE FROM favorites
      WHERE id_user = ? AND id_trail = ?
    `;
    connection.beginTransaction((error) => {
      if (error) {
        connection.rollback(() => {
          connection.release();
          resolve(error);
        });
      }
      connection.query(deleteFavoriteCommand,
        [id_user, id_trail],
        (error, deletedFavoriteData) => {
          if (error) {
            connection.rollback(() => {
              connection.release();
              resolve(error);
            });
          }
          connection.commit((error) => {
            if (error) {
              connection.rollback(() => {
                connection.release();
                resolve(error);
              });
            }
            resolve(deletedFavoriteData);
          });
        });
    });
  });
});

const updateComment = (commentObject) => new Promise((resolve, reject) => {
  poolConnection.getConnection((error, connection) => {
    if (error) reject(error);

    const updateCommentCommand = `
      UPDATE comments
      SET text = ?
      WHERE id = ?
    `;

    connection.beginTransaction((error) => {
      if (error) {
        connection.rollback(() => {
          connection.release();
          resolve(error);
        });
      }
      connection.query(updateCommentCommand,
        [commentObject.text, commentObject.id],
        (error, updatedComment) => {
          if (error) {
            connection.rollback(() => {
              connection.release();
              resolve(error);
            });
          }
          connection.commit((error) => {
            if (error) {
              connection.rollback(() => {
                connection.release();
                resolve(error);
              });
            }
            resolve(updatedComment);
          });
        });
    });
  });
});

module.exports = {
  getUser,
  addUser,
  getTrail,
  addTrail,
  updateTrail,
  deleteTrail,
  updateDifficulty,
  updateLikeability,
  addComment,
  addPhoto,
  deleteComment,
  deletePhoto,
  addFavorite,
  deleteFavorite,
  updateComment,
};

// mysql -uroot < server/index.js
// mysql.server start
